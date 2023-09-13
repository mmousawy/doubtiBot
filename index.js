const tmi = require('tmi.js');
const fs = require('fs');
const path = require('path');
const http = require('http');
const url = require('url');

const parseString = require('xml2js').parseString;

const config = require('./config.json');

// Set the TMI client for Twitch
const client = new tmi.Client({
  options: config.options,
  identity: {
    username: config.identity.username,
    password: config.identity.password,
  },
  channels: config.channels,
});

// Data variables
const GLOBALDATA = config.variables;

// Keeps track of all players and is used for tracking changes
const players = {};

// Reset data files to default values
for (const key in GLOBALDATA) {
  const variable = GLOBALDATA[key];
  variable.value = variable.defaultValue;

  writeToFile(variable.value, `${key}.txt`);
}

// Watch the attributes file for changes
fs.watchFile(config.hunt.attributesPath, (curr, prev) => {
  console.log(`${config.hunt.attributesPath} file Changed`, Date.now());
  updateData();
});

updateData();

function updateData() {
  const xmlData = fs.readFileSync(config.hunt.attributesPath, 'utf8');

  parseString(xmlData, function (err, result) {
    let playerId = 0;
    let playerName = '';
    let playerCount = 0;

    result.Attributes.Attr.forEach((attr) => {
      const item = attr.$;

      // Stop if not a player
      if (item.name.indexOf('MissionBagPlayer') !== 0) {
        return;
      }

      // Create a new entry in the players object
      if (item.name.indexOf('_blood_line_name') !== -1) {
        const idRegex = /MissionBagPlayer_(\d+_\d+)_blood_line_name/;
        playerId = item.name.match(idRegex)[1];

        playerName = item.value;

        if (players[playerId] === undefined) {
          players[playerId] = {
            downedByMe: 0,
            killedByMe: 0,
            killedMe: 0,
            downedMe: 0,
            countForData: false,
            playerName: playerName,
            id: playerId,
          };
        } else if (players[playerId].playerName !== playerName) {
          // Reset values
          players[playerId] = {
            downedByMe: 0,
            killedByMe: 0,
            killedMe: 0,
            downedMe: 0,
            countForData: false,
            playerName: playerName,
            id: playerId,
          };
        }

        playerCount++;

        console.log(playerId, playerName, playerCount);
      }

      // Downed by me
      if (item.name.indexOf('_downedbyme') !== -1) {
        players[playerId].downedByMe = parseInt(item.value);
      }

      // Killed by me
      if (item.name.indexOf('_killedbyme') !== -1) {
        players[playerId].killedByMe = parseInt(item.value);
      }

      // Downed me
      if (item.name.indexOf('_downedme') !== -1) {
        players[playerId].downedMe = parseInt(item.value);
      }

      // Killed me
      if (item.name.indexOf('_killedme') !== -1) {
        players[playerId].killedMe = parseInt(item.value);
      }
    });

    // Log all data
    console.log('>>> Counting data!');

    for (const key in players) {
      const player = players[key];

      if (!player.countForData) {
        continue;
      }

      console.log(player.id, player.name);

      // Set the count flag to false
      player.countForData = false;

      // Downed by me
      GLOBALDATA.kills.value += player.downedByMe;
      GLOBALDATA.kills.value += player.killedByMe;
      GLOBALDATA.deaths.value += player.downedMe;
      GLOBALDATA.deaths.value += player.killedMe;
    }

    for (const key in GLOBALDATA) {
      const variable = GLOBALDATA[key];

      writeToFile(variable.value, `${key}.txt`);
    }

    // Write to file
    fs.writeFile(`./data/players.json`, JSON.stringify(players), function (err) {
      if (err) return console.log(err);
    });
  });
}

http.createServer(function (request, response) {
  try {
    const requestUrl = url.parse(request.url);

    const requestUrlRelative = path.join(process.cwd(), '/data/', path.normalize(requestUrl.pathname));

    var fileStream = fs.createReadStream(requestUrlRelative);

    fileStream.pipe(response);
    fileStream.on('open', function() {
      response.writeHead(200);
    });

    fileStream.on('error', function(e) {
      response.writeHead(404);
      response.end();
    });
  } catch(e) {
    response.writeHead(500);
    response.end();
    console.log(e.stack);
  }
}).listen(config.http.port, config.http.host, () => {
  console.log(`Server is running on http://${config.http.host}:${config.http.port}`);
});

function writeToFile(data, fileName) {
  if (typeof data !== 'string') {
    data = data.toString();
  }

  if (!fs.existsSync('./data')) {
    fs.mkdirSync('./data');
  }

  fs.writeFile(`./data/${fileName}`, data, function (err) {
    if (err) return console.log(err);
  });
}

client.connect().catch(console.error);
client.on('message', (channel, tags, message, self) => {
  const msg = message.replace(/󠀀/g, '').trim().toLowerCase();

  if (self) return;

  if (msg === '!hello') {
    client.say(channel, `@${tags.username}, heya!`);
  }

  if (tags.badges && (!tags.badges.broadcaster && !tags.mod)) {
    // Only broadcaster and mods can use following commands
    return;
  }

  if (msg.toLocaleLowerCase().indexOf('!reset') === 0) {
    const matches = msg.match(/^!reset\s(.+)$/);

    if (!matches) {
      return;
    }

    let varName = matches[1];

    if (GLOBALDATA[varName] === undefined) {
      return;
    }

    GLOBALDATA[varName].value = GLOBALDATA[varName].defaultValue;

    client.say(channel, `@${tags.username}, Reset ${GLOBALDATA[varName].label} to default value: ${GLOBALDATA[varName].defaultValue}`);
    writeToFile(GLOBALDATA[varName].defaultValue, `${varName}.txt`);
    return;
  }

  if (msg.toLocaleLowerCase().indexOf('!') === 0) {
    const matches = msg.match(/^!([a-z]+)\s?(\+|\-|add|sub)?\s?(\d+)?$/);

    if (!matches) {
      return;
    }

    let varName = matches[1];

    if (data[varName] === undefined) {
      console.log(matches);
      return;
    }

    const operator = matches[2];

    // Get
    if (!operator) {
      client.say(channel, `@${tags.username}, Current ${data[varName].label}: ${data[varName].value}`);
      return;
    }

    let val = matches && matches[3];
    let newVal = 1;

    if (val && val.length !== 0 && !isNaN(parseInt(val))) {
      newVal = parseInt(val);
    }

    // Subtract
    if (operator === '-' || operator === 'sub') {
      client.say(channel, `@${tags.username}, Subtracted -${newVal} to ${data[varName].label}. Total ${data[varName].label}: ${data[varName].value - newVal}`);

      data[varName].value -= newVal;
    }

    // Add
    if (operator === '+' || operator === 'add') {
      client.say(channel, `@${tags.username}, Added +${newVal} to ${data[varName].label}: Total ${data[varName].label}: ${data[varName].value + newVal}`);
      data[varName].value += newVal;
    }

    writeToFile(data[varName].value, `${varName}.txt`);
  }
});
