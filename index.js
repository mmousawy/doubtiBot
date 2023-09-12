const tmi = require('tmi.js');
const fs = require('fs');

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

  writeToFile(variable.value, `${variable.label}.txt`);
}

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

  if (msg.toLocaleLowerCase().indexOf('!reset') === 0) {
    const matches = msg.match(/^!reset\s(.+)$/);

    if (!matches) {
      return;
    }

    let varName = matches[1];

    if (data[varName] === undefined) {
      return;
    }

    client.say(channel, `@${tags.username}, Reset ${data[varName].label} to default value: ${data[varName].defaultValue}`);
    writeToFile(data[varName].value, `${varName}.txt`);
    return;
  }

  if (msg.toLocaleLowerCase().indexOf('!') === 0) {
    const matches = msg.match(/^!([a-z]+)\s?(\+|\-)?\s?(\d+)?$/);

    if (!matches) {
      return;
    }

    let varName = matches[1];

    if (data[varName] === undefined) {
      console.log(matches);
      return;
    }

    const operator = matches[2];

    if (!operator) {
      client.say(channel, `@${tags.username}, Current ${data[varName].label}: ${data[varName].value}`);
      return;
    }

    let val = matches && matches[3];
    let newVal = 1;

    if (val && val.length !== 0 && !isNaN(parseInt(val))) {
      newVal = parseInt(val);
    }

    if (operator === '-') {
      client.say(channel, `@${tags.username}, Reduced -${newVal} to ${data[varName].label}. Total ${data[varName].label}: ${data[varName].value - newVal}`);

      data[varName].value -= newVal;
    }

    if (operator === '+') {
      client.say(channel, `@${tags.username}, Added +${newVal} to ${data[varName].label}: Total ${data[varName].label}: ${data[varName].value + newVal}`);
      data[varName].value += newVal;
    }

    writeToFile(data[varName].value, `${varName}.txt`);
  }
});
