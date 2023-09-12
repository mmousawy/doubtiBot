const tmi = require('tmi.js');
const fs = require('fs');
const path = require('path');
const http = require('http');
const url = require('url');

const config = require('./config.json');

const client = new tmi.Client({
  options: config.options,
  identity: {
    username: config.identity.username,
    password: config.identity.password,
  },
  channels: config.channels,
});

const data = config.variables;

for (const key in data) {
  const variable = data[key];
  variable.value = variable.defaultValue;

  writeToFile(variable.value, `${key}.txt`);
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

    if (data[varName] === undefined) {
      return;
    }

    data[varName].value = data[varName].defaultValue;

    client.say(channel, `@${tags.username}, Reset ${data[varName].label} to default value: ${data[varName].defaultValue}`);
    writeToFile(data[varName].defaultValue, `${varName}.txt`);
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
