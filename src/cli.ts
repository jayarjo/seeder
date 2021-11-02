#!/usr/bin/env node
import { camelCase } from 'camel-case';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { PostgisSeeder, Seeder } from '.';
import { invariant } from './utils';

type CliOptions = {
  host?: string;
  port?: number;
  database: string;
  user?: string;
  password?: string;
  tables: string;
  factoryDir?: string;
  num?: number;
  postgis?: boolean;
};

const [, , ...args] = process.argv;
const VERSION = require(resolve(__dirname, '../package.json')).version;

const parseOptions = (options: string[]): CliOptions =>
  options.reduce((obj: any, opt: string) => {
    const [key, value = true] = opt.split('=');
    obj[camelCase(key.replace(/^-+/, ''))] = value;
    return obj;
  }, {});

const showHelp = () => {
  process.stdout.write(
    `seeder v${VERSION}` +
      '\nOptions:\n' +
      '  --version        Show version\n' +
      '  --help           Show this help\n' +
      '\n' +
      "  --host           DB host (default: 'localhost')\n" +
      "  --port           DB port (default: '5432')\n" +
      "  --user           DB user (default: 'postgres')\n" +
      "  --password       DB password (default: 'postgres')\n" +
      '  --database       DB name\n' +
      '\n' +
      '  --tables         Comma-separated list of tables to seed\n' +
      '  --factory-dir    Directory containing factories per table\n' +
      "  --num            Number of rows to generate (default: '10')\n" +
      "  --postgis        Whether to enable PostGIS adapter (default: 'false')\n" +
      '\nUsage:\n' +
      '  seeder --help\n\n'
  );
};

const showVersion = () => {
  process.stdout.write(`seeder v${VERSION}\n`);
};

const getFactory = (tableName, factoryDir) => {
  const factoryPath = resolve(process.cwd(), factoryDir, `${tableName}.js`);
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
  return factory;
};

const handleCommand = async ({
  host = 'localhost',
  port = 5432,
  user = 'postgres',
  password = 'postgres',
  database,
  tables,
  factoryDir,
  num = 10,
  postgis = false,
  ...seederOptions
}: CliOptions) => {
  invariant(database, `You need to specify a DB to connect to (see --database param option)`);
  invariant(tables, `You need to specify tables to seed (see --tables option)`);
  invariant(
    !factoryDir || existsSync(factoryDir),
    `Directory for factories (${factoryDir}) is invalid or doesn't exist`
  );

  const seeder = new (postgis ? PostgisSeeder : Seeder)(
    { host, port: +port, user, password, database },
    { ignoreNullable: false, fixSerials: false, ...seederOptions }
  );

  try {
    const tableNames = tables.split(',');

    if (tableNames.length === 1) {
      if (!factoryDir) {
        await seeder.seed(tableNames[0], {}, num);
      } else {
        await seeder.seed(tableNames[0], getFactory(tableNames[0], factoryDir), num);
      }
    } else {
      if (!factoryDir) {
        await seeder.seed(tableNames);
      } else {
        const data = tableNames.reduce(
          (obj, tableName) => ({ ...obj, [tableName]: getFactory(tableName, factoryDir) }),
          {}
        );
        await seeder.seed(data);
      }
    }

    await seeder.close();
    process.exit(0);
  } catch (ex) {
    console.error(`Error: ${ex.message}`);
    await seeder.close();
    process.exit(1);
  }
};

if (!args.length || args[0] === '--help') {
  showHelp();
} else if (args[0] === '--version') {
  showVersion();
} else {
  handleCommand(parseOptions(args));
}
