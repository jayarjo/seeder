import { camelCase } from 'camel-case';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { PostgisSeeder } from '.';
import { invariant } from './utils';

type CliOptions = {
  host?: string;
  port?: number;
  database: string;
  user?: string;
  password?: string;
  tables: string;
  factoryDir?: string;
};

const [, , ...args] = process.argv;
const VERSION = require('./package.json').version;

const parseOptions = (options: string[]): CliOptions =>
  options.reduce((obj: any, opt: string) => {
    const [key, value = true] = opt.split('=');
    obj[camelCase(key.replace(/^-+/, ''))] = value;
    return obj;
  }, {});

const showHelp = () => {
  process.stdout.write(
    `seeder v${VERSION}` +
      '\n' +
      'Options:\n' +
      '  --version        Show version\n' +
      '  --help           Show this help\n' +
      '\n' +
      'Usage:\n' +
      '  seeder --help\n\n'
  );
};

const showVersion = () => {
  process.stdout.write(`seeder v${VERSION}`);
};

const handleCommand = async ({
  host = 'localhost',
  port = 5432,
  user = 'postgres',
  password = 'postgres',
  database,
  tables,
  factoryDir,
  ...seederOptions
}: CliOptions) => {
  invariant(database, `You need to specify a DB to connect to (see --database param option)`);
  invariant(tables, `You need to specify tables to seed (see --tables option)`);
  invariant(
    factoryDir && !existsSync(factoryDir),
    `Directory for factories (${factoryDir}) is invalid or doesn't exist`
  );

  const seeder = new PostgisSeeder({ host, port, user, password, database }, seederOptions);

  const tableNames = tables.split(',');

  if (!factoryDir) {
    await seeder.seed(tableNames);
  } else {
    const data = tableNames.reduce((obj, tableName) => {
      const factoryPath = resolve(__dirname, factoryDir, 'table.js');
      if (!existsSync(factoryPath)) {
        console.error(`Factory for ${tableName} cannot be found at ${factoryPath}`);
        process.exit(1);
      }

      const factory = require(factoryPath).default;
      if (typeof factory !== 'function') {
        console.error(
          `Factory file should reside in ${factoryDir}, be named after the table (e.g. ${tableName}.js) and export single factory function as default`
        );
        process.exit(1);
      }

      return { ...obj, [tableName]: factory };
    }, {});

    await seeder.seed(data);
  }
};

if (!args.length || args[0] === '--help') {
  showHelp();
} else if (args[0] === '--version') {
  showVersion();
} else {
  handleCommand(parseOptions(args));
}
