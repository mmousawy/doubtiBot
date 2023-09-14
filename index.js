const tmi = require('tmi.js');
const fs = require('fs');
const path = require('path');
const http = require('http');
const url = require('url');

const parseString = require('xml2js').parseString;

const config = require('./config.json');

let firstRun = true;

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
const OUTPUT = config.variables;

// Keeps track of all players and is used for tracking changes
const DATA = {
  players: {},
  entries: {},
};

// Reset data files to default values
for (const key in OUTPUT) {
  const variable = OUTPUT[key];
  const foundValue = fs.readFileSync(`./data/${key}.txt`);

  variable.value = parseInt(foundValue);
}

// Watch the attributes file for changes
fs.watchFile(config.hunt.attributesPath, (curr, prev) => {
  console.log(`# File changed`, new Date().toLocaleTimeString());
  updateData();
});

updateData();

function saveMissionBagEntry(xmlItem, entries) {
  const nameRegex = /MissionBagEntry_(\d+)_(.+)/;
  const matches = xmlItem.name.match(nameRegex);

  if (!matches) {
    return;
  }

  const itemId = matches[1];
  const itemName = matches[2];

  // All items
  entries[itemId][itemName] = xmlItem.value;
}

function saveMissionBagPlayer(xmlItem, playerId, playerName) {
  const nameRegex = /MissionBagPlayer_(\d+_\d+)_(.+)/;
  const matches = xmlItem.name.match(nameRegex);

  if (!matches) {
    return;
  }

  const itemId = matches[1];
  const itemName = matches[2];

  // All items
  DATA.players[itemId][itemName] = xmlItem.value;
}

function updateData() {
  const xmlData = fs.readFileSync(config.hunt.attributesPath, 'utf8');
  const newEntries = {};

  parseString(xmlData, function (err, result) {
    let playerId = 0;
    let playerName = '';
    let entryId = 0;

    result.Attributes.Attr.forEach((attr) => {
      const item = attr.$;

      // Entries
      if (item.name.indexOf('MissionBagEntry') === 0) {
        const idRegex = /^MissionBagEntry_(\d+)$/;
        const matches = item.name.match(idRegex);

        if (matches) {
          entryId = matches[1];

          if (newEntries[entryId] === undefined) {
            newEntries[entryId] = {
              id: entryId,
            };
          }
        }

        saveMissionBagEntry(item, newEntries);
      }

      // Players
      if (item.name.indexOf('MissionBagPlayer') === 0) {
        // Create a new entry in the players object
        if (item.name.indexOf('_blood_line_name') !== -1) {
          const idRegex = /MissionBagPlayer_(\d+_\d+)_blood_line_name/;
          playerId = item.name.match(idRegex)[1];
          playerName = item.value;

          if (DATA.players[playerId] === undefined) {
            DATA.players[playerId] = {
              name: playerName,
              id: playerId,
            };
          } else if (DATA.players[playerId].name !== playerName) {
            // Reset values
            DATA.players[playerId] = {
              name: playerName,
              id: playerId,
              countForData: true,
            };
          }
        }

        saveMissionBagPlayer(item, playerId, playerName);
      }
    });

    // Log all data
    console.log('>>> Counting data!');

    let matchEnded = false;

    const matchData = {
      kills: 0,
      deaths: 0,
      assists: 0,
    };

    if (firstRun) {
      DATA.entries = newEntries;

    } else {
      for (const entryId in newEntries) {
        const entry = newEntries[entryId];

        if (DATA.entries[entryId].category !== entry.category) {
          // New entry

          // Count assists
          if (entry.category === 'accolade_players_killed_assist') {
            console.log('> Counting assists:', entry);
            matchData.assists += parseInt(entry.amount);
          }

          DATA.entries[entryId] = entry;
        }
      }
    }

    for (const playerId in DATA.players) {
      const player = DATA.players[playerId];

      if (!player.countForData) {
        continue;
      } else {
        // Set matchEnded flag to signal that the match has ended
        matchEnded = true;
      }

      console.log('> Counting data for player:', player.id, player.name);

      // Set the count flag to false
      player.countForData = false;

      // Aggregate amounts
      matchData.kills += parseInt(player.downedbyme) + parseInt(player.killedbyme);
      matchData.deaths += parseInt(player.downedme) + parseInt(player.killedme);
    }

    // Aggregate amounts
    OUTPUT.kills.value += matchData.kills;
    OUTPUT.deaths.value += matchData.deaths;
    OUTPUT.assists.value += matchData.assists;

    for (const key in OUTPUT) {
      const variable = OUTPUT[key];

      writeToFile(variable.value, `${key}.txt`);
    }

    if (matchEnded) {
      console.log('>>> Match ended!');

      client.channels.forEach((channel) => {
        client.say(channel, `/me Match ended! Results: ${ matchData.kills } Kill${ matchData.kills === 1 ? '' : 's' } / ${ matchData.deaths } Death${ matchData.deaths === 1 ? '' : 's' } / ${ matchData.assists } Assist${ matchData.assists === 1 ? '' : 's' }`);
      });
    }

    // Write to file
    fs.writeFile(`./data/data.json`, JSON.stringify(DATA, null, 2), function (err) {
      if (err) return console.log(err);
    });
  });

  firstRun = false;
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
announceBotConnected();

function announceBotConnected() {
  setTimeout(() => {
    if (!client.channels.length) {
      announceBotConnected();
      return;
    }

    client.channels.forEach((channel) => {
      client.say(channel, `/me [${new Date().toLocaleTimeString()}] I am ready to track your games! Type !kills, !deaths, !assists to view the stats. 🤖`);
      client.say(channel, `/me Current stats: ${ OUTPUT.kills.value } Kill${ OUTPUT.kills.value === 1 ? '' : 's' } / ${ OUTPUT.deaths.value } Death${ OUTPUT.deaths.value === 1 ? '' : 's' } / ${ OUTPUT.assists.value } Assist${ OUTPUT.assists.value === 1 ? '' : 's' }
      `);
    });
  }, 100);
}

client.on('message', (channel, tags, message, self) => {
  const msg = message.replace(/󠀀/g, '').trim().toLowerCase();

  if (self) return;

  if (msg === '!hey') {
    client.say(channel, `Heya @${tags.username}!`);
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

    if (OUTPUT[varName] === undefined) {
      return;
    }

    OUTPUT[varName].value = OUTPUT[varName].defaultValue;

    client.say(channel, `@${tags.username}, Reset ${OUTPUT[varName].label} to default value: ${OUTPUT[varName].defaultValue}`);
    writeToFile(OUTPUT[varName].defaultValue, `${varName}.txt`);
    return;
  }

  if (msg.toLocaleLowerCase().indexOf('!') === 0) {
    const matches = msg.match(/^!([a-z]+)\s+?(\+|\-|add|sub)?\s+?(\d+)?$/);

    if (!matches) {
      return;
    }

    let varName = matches[1];

    // Does the variable exist?
    if (OUTPUT[varName] === undefined) {
      // If not, cancel
      return;
    }

    const operator = matches[2];

    // Get
    if (!operator) {
      client.say(channel, `@${tags.username}, Current ${OUTPUT[varName].label}: ${OUTPUT[varName].value}`);
      return;
    }

    let val = matches && matches[3];
    let newVal = 1;

    if (val && val.length !== 0 && !isNaN(parseInt(val))) {
      newVal = parseInt(val);
    }

    // Subtract
    if (operator === '-' || operator === 'sub') {
      client.say(channel, `@${tags.username}, Subtracted ${newVal} from ${OUTPUT[varName].label}. Total ${OUTPUT[varName].label}: ${OUTPUT[varName].value - newVal}`);

      OUTPUT[varName].value -= newVal;
    }

    // Add
    if (operator === '+' || operator === 'add') {
      client.say(channel, `@${tags.username}, Added ${newVal} to ${OUTPUT[varName].label}. Total ${OUTPUT[varName].label}: ${OUTPUT[varName].value + newVal}`);
      OUTPUT[varName].value += newVal;
    }

    writeToFile(OUTPUT[varName].value, `${varName}.txt`);
  }
});
