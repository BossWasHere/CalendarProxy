import fs from 'fs';
import { getFormatter } from './formatters/index.js';
import { Calendar } from './calendar.js';

const argCount = process.argv.length;

if (argCount < 4) {
    console.error('Usage: node dist/cli.js <file> <formatter>');
    process.exit(1);
}

const file = process.argv[2];
const formatterName = process.argv[3];

// try to get the formatter
const formatter = getFormatter(formatterName);
if (formatter === undefined) {
    console.error(`Invalid formatter: ${formatterName}`);
    process.exit(1);
}

// try to read the file
let data;
try {
    data = fs.readFileSync(file, 'utf8');
}
catch (err) {
    console.error(`Error reading file: ${err}`);
    process.exit(1);
}

const calendar = new Calendar(data, 0);
calendar.applyFormatter(formatter);

console.log(calendar.toString());
