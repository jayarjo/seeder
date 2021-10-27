import pgStructure, { Db, Entity, Column, EnumType, ForeignKey, Action } from 'pg-structure';
import { Client, ClientConfig } from 'pg';
import faker from 'faker';
import { prepareValue } from 'pg/lib/utils';
import { invariant, isEmpty, isEmptyObj, changeKeyCase, isEmptyArray } from '../utils';
import { random, omit, repeat } from 'lodash';
import { TableName, TableRow, SeedRegistry, RowFactory, RowFactoryGenerator, DependencyMesh, Meta } from '../types';

const log = require('debug')('truck-tester:seeder');

const isRelative = (key: ForeignKey): boolean => key.onDelete === Action.NoAction;
const isBoss = (key: ForeignKey): boolean => !isRelative(key);

const fakeAddressObject = () =>
  Object.keys(faker.address).reduce(
    (acc, key) =>
      faker.address.hasOwnProperty(key) && typeof faker.address[key] === 'function'
        ? { ...acc, [key]: faker.address[key]() }
        : acc,
    {}
  );

type Constraint = {
  constraintName: string;
  tableSchema: string;
  tableName: string;
  columnName: string;
  condition: string;
};

export interface SeederProps {
  /**
   * Array of column names to not generate value for
   */
  ignoreColumns?: string[];
  /**
   * If set to `true` (default) values won't be generated for nullable columns
   */
  ignoreNullable?: boolean;
  /**
   * If set to `true` (default) values won't be generated for serial columns (autoincrmentables)
   */
  ignoreSerials?: boolean;
  /**
   * If rows are inserted with defined values for serials, their corresponding sequentials are
   * not auto-incremented, when `true` (default) `fixSerials` auto-fixes sequentials to continue
   * incrementing from max serial value in the table
   */
  fixSerials?: boolean;
  /**
   * If table has foreign keys, it won't be possible to insert the row without first inserting
   * foreign rows, if `settleForeignRelations` is `true` (default), foreign dependencies will
   * be inserted automatically. However in some cases it might be undesirable (for example when
   * table has some weird constraints)
   */
  settleForeignRelations?: boolean;
  /**
   * If tables contain possible values for columns in other tables, in somewhat alternative to
   * enums, their names can be listed in `enumTables` and that will be taken into account. Also
   * corresponding tables won't be truncated by default in {@link truncateAll}
   */
  enumTables?: string[];
  /**
   * By default seeding to the table that has predefined values (see {@link enumTables}) is not
   * allowed
   */
  allowSeedingEnumTable?: boolean;
  /**
   * By default Seeder will attempt to insert the row, despite the constraints and might fail if
   * values do not satisfy their conditions - this might not be an undesirable behavior, thus this
   * option, which instructs the Seeder to throw immediately if contsraint is detected in the table
   */
  throwIfTableHasCheckConstraints?: boolean;
}

export class Seeder {
  static uniqPrefix = 1;

  protected props: SeederProps;
  protected struct: Db;

  protected seededRegistry: SeedRegistry = {};

  protected pgClient: Client;

  /**
   * Only CHECK constraints
   */
  protected constraintsByTable: Record<TableName, Constraint[]> = {};

  constructor(pgClient: string | ClientConfig | Client, props: SeederProps = {}) {
    if (pgClient instanceof Client) {
      this.pgClient = pgClient;
    } else if (typeof pgClient === 'string') {
      this.pgClient = new Client({
        connectionString: pgClient,
      });
    } else if (typeof pgClient === 'object') {
      this.pgClient = new Client(pgClient);
    } else {
      throw new Error(`pgClient argument should be either connectionString, ClientConfig or instance of Client`);
    }

    this.props = {
      ignoreColumns: [],
      ignoreNullable: true,
      ignoreSerials: true,
      // if values for serial columns are provided seq won't be incremented, which might result in duplicate errors
      fixSerials: true,
      settleForeignRelations: true,
      enumTables: [],
      allowSeedingEnumTable: false,
      throwIfTableHasCheckConstraints: false,
      ...props,
    };
  }

  protected async getStruct(): Promise<Db> {
    if (!this.struct) {
      this.struct = await pgStructure(this.pgClient, { includeSchemas: ['public'], keepConnection: true });
      // potentially we could try and satisfy those constraints automatically (TODO: investigate that)
      this.constraintsByTable = await this.getConstraints();
    }
    return this.struct;
  }

  protected async getTableSchema(tableName): Promise<Entity> {
    const struct = await this.getStruct();
    return struct.get(tableName) as Entity;
  }

  protected async getConstraints(): Promise<Record<TableName, Constraint[]>> {
    const { rows, rowCount } = await this.pgClient.query(`
      SELECT 
        pgc.conname AS constraint_name, 
        ccu.table_schema AS table_schema, 
        ccu.table_name, 
        ccu.column_name, 
        pgc.consrc AS condition 
      FROM pg_constraint pgc 
        LEFT JOIN information_schema.constraint_column_usage ccu 
          ON pgc.conname = ccu.constraint_name 
      WHERE table_schema = 'public' AND contype = 'c' 
      ORDER BY constraint_name; 
    `);
    if (rowCount) {
      return rows.reduce((map, row) => {
        if (!map[row.table_name]) {
          map[row.table_name] = [];
        }
        map[row.table_name].push(changeKeyCase(row, 'camelCase'));
        return map;
      }, {});
    } else {
      return {};
    }
  }

  protected hasConstraints(tableName: TableName): boolean {
    return !isEmptyArray(this.constraintsByTable[tableName]);
  }

  protected getConstrainedColumnNamesFor(tableName: TableName): string[] {
    const constraints = this.constraintsByTable[tableName];
    return isEmptyArray(constraints) ? [] : constraints.map(({ columnName }) => columnName);
  }

  protected hasValuesForConstrainedColumns(tableName: TableName, factoryData: RowFactory) {
    const columnNames = this.getConstrainedColumnNamesFor(tableName);
    if (isEmptyArray(columnNames)) {
      return true;
    }
    return isEmptyObj(factoryData) ? false : columnNames.every((columnName) => factoryData[columnName] !== undefined);
  }

  protected async buildTableDependencyMesh(data: Record<TableName, TableRow[]>): Promise<DependencyMesh> {
    const struct = await this.getStruct();

    return Object.keys(data).reduce((depMesh, tableName) => {
      const tableSchema = struct.get(tableName) as Entity;

      const getOrCreateMeta = (tableName: string): Meta =>
        depMesh[tableName] ??
        (depMesh[tableName] = {
          dependencies: {},
          dependents: {},
          wasSeeded: false,
          foreignRefs: {},
          valueMaps: {},
        });

      const tableMeta = getOrCreateMeta(tableName);

      for (const col of tableSchema.columns) {
        if (col.isPrimaryKey) {
          tableMeta.primaryKey = col.name;
        } else if (col.isForeignKey) {
          const foreignKey = col.foreignKeys[0];
          const foreignTableName = foreignKey?.referencedTable?.name;
          const foreignName = foreignKey?.referencedColumns[0]?.name;

          // we only care about tables that are provided in the initial data
          if (!data[foreignTableName]) {
            continue;
          }

          invariant(
            foreignKey.referencedColumnsBy.length === 1,
            `UNHANDLED CASE: ${
              foreignKey.name
            } is referenced by more than one column: ${foreignKey.referencedColumnsBy
              .map((ref) => ref.column.name)
              .join()}`
          );

          const foreignTableMeta = getOrCreateMeta(foreignTableName);

          tableMeta.foreignRefs[col.name] = {
            tableName: foreignTableName,
            columnName: foreignName,
          };
          tableMeta.dependencies[foreignTableName] = foreignTableMeta;
          foreignTableMeta.dependents[tableName] = tableMeta;
        }
      }
      return depMesh;
    }, {});
  }

  protected logInRegistry(tableName: TableName, row: TableRow) {
    this.seededRegistry[tableName] = [...(this.seededRegistry[tableName] || []), row];
  }

  protected prepareValue(value: any) {
    const preparedValue = prepareValue(value);
    return `${typeof preparedValue === 'string' ? this.pgClient.escapeLiteral(preparedValue) : preparedValue}`;
  }

  protected prepareSql(sql, values): string {
    let idx = 0;
    sql = sql.replace(/\$(\d+)/g, ($0, $1) => {
      const value = values[idx++];
      invariant(value !== undefined, `Cannot prepare ${sql}: no value for placeholder $${$1}`);

      return this.prepareValue(value);
    });
    return sql;
  }

  protected async fixSerial(col: Column, startValue?: number): Promise<number> {
    // nextval('truck_tester_table2_id_seq'::regclass)
    const seqName = col.default.toString().match(/^nextval\('([^\']+)'/i)?.[1];
    const {
      rows: [lastRow],
    } = await this.pgClient.query(
      `SELECT setval('${seqName}', ${startValue ?? `(SELECT MAX(id) from "${col.table.name}")`}) AS id`
    );
    return lastRow.id;
  }

  protected async getRow(tableName: string, where: any = {}): Promise<TableRow> {
    const whereClause = Object.keys(where)
      .map((key, i) => `${key} = $${i + 1}`)
      .join(' AND ');
    const {
      rows: [lastRow],
    } = await this.pgClient.query(
      `SELECT * FROM ${tableName} ${!isEmpty(whereClause) ? `WHERE ${whereClause}` : 'ORDER BY id DESC'}`,
      Object.values(where)
    );
    return lastRow;
  }

  protected async insertRow(tableName, row: any = {}): Promise<TableRow> {
    let sql;
    if (isEmptyObj(row)) {
      sql = `INSERT INTO ${tableName} DEFAULT VALUES RETURNING *`;
    } else {
      const cols = Object.keys(row).map((colName) => this.pgClient.escapeIdentifier(colName));
      const values = Object.values(row);
      const placeholdersStr = values.map((_, idx) => `$${idx + 1}`).join(', ');
      sql = this.prepareSql(
        `INSERT INTO ${tableName} (${cols.join(', ')}) VALUES (${placeholdersStr}) RETURNING *`,
        values
      );
    }
    log(sql);
    const { rows } = await this.pgClient.query(sql);

    invariant(
      !isEmptyObj(rows[0]),
      `Row wasn't inserted into '${tableName}', maybe recheck if it satisfies Triggers: ${JSON.stringify(row)}`
    );

    return rows[0];
  }

  protected async processFactoryValue(col: Column, value: any) {
    value = typeof value === 'function' ? value(col) : value;
    // adapt array values for insertion to DB
    if (Array.isArray(value) && col.arrayDimension > 0) {
      value = JSON.stringify(value).replace(/[\[\]]/g, ($1) => ({ '[': '{', ']': '}' }[$1]));
    }
    return value;
  }

  protected async generateValue(col: Column) {
    switch (col.type.name) {
      case 'smallint':
      case 'integer':
      case 'bigint':
      case 'numeric':
      case 'decimal':
      case 'double precision':
      case 'real':
        return col.isPrimaryKey ? Seeder.uniqPrefix++ : faker.random.number({ min: 1, max: 1000 }); // TODO: consider taking into account precision/scale

      case 'character varying':
      case 'varchar':
      case 'character':
      case 'char':
        // is primary key, but isn't serial, so should be random, but unique - lets use timestamp
        const word = col.isPrimaryKey ? `${Seeder.uniqPrefix++}${Date.now()}` : faker.random.word();
        return col.length ? word.substr(0, col.length) : word;

      case 'date':
      case 'timestamp':
      case 'timestamptz':
      case 'timestamp with time zone':
      case 'timestamp without time zone':
        return faker.date.recent(10);

      case 'text':
        return faker.random.words(4);

      case 'inet':
        return faker.internet.ip();

      case 'macaddr':
        return faker.internet.mac();

      case 'cidr':
        return `10.0.0.0/24`;

      case 'boolean':
        return faker.random.boolean();

      case 'uuid':
        return faker.random.uuid();

      case 'json':
      case 'jsonb':
        invariant(col.arrayDimension === 0, `ARRAY not supported for ${col.type.name} columns`);
        return fakeAddressObject(); // random address as an object

      default:
        if (col.type instanceof EnumType) {
          return faker.random.arrayElement(col.type.values);
        } else if (!col.notNull) {
          return null;
        }
        throw new Error(`Unhandled column type: '${col.type.name}'`);
    }
  }

  protected async grabRandomValueFor(tableName: TableName, colName: string, limit = 100): Promise<any> {
    const { rows, rowCount } = await this.pgClient.query(`SELECT ${colName} FROM ${tableName} LIMIT ${limit}`);
    invariant(rowCount > 0, `'${tableName}' is declared as non empty table, but is empty`);
    return rows[random(0, rows.length - 1)][colName];
  }

  protected isIgnorable(col: Column): boolean {
    const { ignoreNullable, ignoreSerials, ignoreColumns } = this.props;
    return (
      col.default !== null ||
      (!col.notNull && ignoreNullable) ||
      (col.isSerial && ignoreSerials) ||
      ignoreColumns.includes(col.name)
    );
  }

  protected async resolveForeignKey(foreignKey: ForeignKey, factoryValue?: any) {
    const { throwIfTableHasCheckConstraints } = this.props;
    const hasFactoryValue = factoryValue !== undefined;
    const foreignTableName = foreignKey?.referencedTable?.name;
    const foreignName = foreignKey?.referencedColumns[0]?.name;

    invariant(
      foreignKey.referencedColumnsBy.length === 1,
      `UNHANDLED CASE: ${foreignKey.name} is referenced by more than one column: ${foreignKey.referencedColumnsBy
        .map((ref) => ref.column.name)
        .join()}
      `
    );

    invariant(
      !throwIfTableHasCheckConstraints || !this.hasConstraints(foreignTableName),
      `Table '${foreignTableName}' has CHECK constraints - consider seeding it manually`
    );

    log(
      `settling foreign key '${foreignKey.referencedColumnsBy[0].column.name}: ${foreignKey.name}' in ${foreignTableName}`
    );

    if (this.props.enumTables.includes(foreignTableName) && !hasFactoryValue) {
      log(`'${foreignTableName}' table contains pre-defined values, grabbing random one...`);
      return this.grabRandomValueFor(foreignTableName, foreignName);
    }

    let foreignRow;
    // make sure that a row with such a key doesn't exist yet in the foreign table
    if (hasFactoryValue) {
      foreignRow = await this.getRow(foreignTableName, { [foreignName]: factoryValue });
      if (foreignRow) {
        log(`found existing row - using that...`);
        return foreignRow[foreignName];
      }
    }

    foreignRow = await this.seedRow(
      foreignTableName,
      hasFactoryValue && isRelative(foreignKey) ? { [foreignName]: factoryValue } : {}
    );
    return foreignRow[foreignName];
  }

  protected async seedForeignRows(tableName: TableName, data: any = {}): Promise<Partial<TableRow>> {
    const tableSchema = await this.getTableSchema(tableName);
    const row = {};
    for (const col of tableSchema.columns) {
      if (col.isForeignKey) {
        // if we can set foreign key to NULL then lets do that without any conditionals, preventing
        // potential circular dependencies (there's one in Task Managements cartographer-db)
        row[col.name] =
          col.notNull || data[col.name] !== undefined
            ? await this.resolveForeignKey(col.foreignKeys[0], data[col.name])
            : null;
      }
    }
    return row;
  }

  protected async generateRow(tableName, factoryData: any = {}): Promise<TableRow> {
    const tableSchema = await this.getTableSchema(tableName);
    const { ignoreNullable, settleForeignRelations, fixSerials } = this.props;

    // TODO: probably need to handle multi-column foreign keys here as well
    const foreignData = settleForeignRelations ? await this.seedForeignRows(tableName, factoryData) : {};
    const data = { ...factoryData, ...foreignData };

    const row = {};
    for (const col of tableSchema.columns) {
      // if factory value is provided, it will be used and never ignored, also if it's
      // a foreign key, it won't be resolved, even if settleForeignRelations is enabled,
      // but used as is, only - normalized
      if (data[col.name] !== undefined) {
        row[col.name] = await this.processFactoryValue(col, data[col.name]);
      }
      // serials, nullables or all other columns that should or can be ignored will be igniored
      else if (this.isIgnorable(col)) {
        if (col.isSerial && fixSerials) {
          await this.fixSerial(col);
        }
        continue;
      } else {
        const value = await this.generateValue(col);
        row[col.name] =
          // make sure that we adequately handle arrays (TODO: optionally we could generate random number of items)
          col.arrayDimension > 0
            ? `${repeat('{', col.arrayDimension)}${value.toString()}${repeat('}', col.arrayDimension)}`
            : value;
      }
    }
    return row;
  }

  protected async seedRow(tableName, factoryData: any = {}) {
    const row = await this.generateRow(tableName, factoryData);
    const seededRow = await this.insertRow(tableName, row);
    this.logInRegistry(tableName, seededRow);
    log(`seeded row: ${JSON.stringify(seededRow)}`);
    return seededRow;
  }

  protected async seedMultiTable(
    data: Record<TableName, RowFactory[]>,
    ignorePrimaryKeys = true
  ): Promise<SeedRegistry> {
    const { allowSeedingEnumTable, enumTables } = this.props;
    const depMesh = await this.buildTableDependencyMesh(data);

    const seedDepTable = async (tableName: string, meta: Meta) => {
      const { primaryKey, dependencies, wasSeeded, foreignRefs } = meta;

      // process only once
      if (wasSeeded) {
        return;
      }

      let rows: RowFactory[] = data[tableName].map((rowFactory: RowFactory, i: number) =>
        typeof rowFactory === 'function' ? rowFactory(i) : rowFactory
      );

      // if given table has dependencies process them first one by one
      if (!isEmptyObj(dependencies)) {
        for (const depTableName in dependencies) {
          await seedDepTable(depTableName, dependencies[depTableName]);
        }
        if (ignorePrimaryKeys) {
          // if value for foreignKey has been altered, replace it in factory data
          rows = rows.map((row) => {
            const patchedColumns = {};
            for (const key in foreignRefs) {
              const foreignRef = foreignRefs[key];
              if (row.hasOwnProperty(key)) {
                patchedColumns[key] =
                  dependencies[foreignRef.tableName].valueMaps[foreignRef.columnName][row[key]] ?? row[key];
              }
            }
            return { ...row, ...patchedColumns };
          });
        }
      }

      // seed each row and log mapping between original and final result of primary keys
      const valueMaps = { [primaryKey]: {} };
      for (let i = 0; i < rows.length; i++) {
        const seededRow = await this.seedRow(tableName, omit(rows[i], primaryKey));

        if (rows[i].hasOwnProperty(primaryKey)) {
          valueMaps[primaryKey][rows[i][primaryKey]] = seededRow[primaryKey];
        }
      }
      meta.valueMaps = valueMaps;
      meta.wasSeeded = true;
    };

    this.seededRegistry = {}; // start fresh
    try {
      await this.pgClient.query('BEGIN');
      for (const tableName in data) {
        invariant(
          allowSeedingEnumTable || isEmptyArray(enumTables) || !enumTables.includes(tableName),
          `Table '${tableName}' contains pre-defined values, if you still want to seed it, set 'allowSeedingEnumTable' to true`
        );
        await seedDepTable(tableName, depMesh[tableName]);
      }
      await this.pgClient.query('COMMIT');
      return this.seededRegistry;
    } catch (ex) {
      await this.pgClient.query('ROLLBACK');
      throw ex;
    }
  }

  protected async seedTable(
    tableName,
    rowFactory: RowFactory | RowFactoryGenerator,
    num: number = 1
  ): Promise<TableRow[]> {
    const { allowSeedingEnumTable, enumTables } = this.props;

    invariant(
      allowSeedingEnumTable || isEmptyArray(enumTables) || !enumTables.includes(tableName),
      `Table '${tableName}' contains pre-defined values, if you still want to seed it, set 'allowSeedingEnumTable' to true`
    );

    this.seededRegistry = {}; // start fresh
    try {
      await this.pgClient.query('BEGIN');
      for (let i = 0; i < num; i++) {
        await this.seedRow(tableName, typeof rowFactory === 'function' ? rowFactory(i) : rowFactory);
      }
      await this.pgClient.query('COMMIT');
      return this.seededRegistry[tableName];
    } catch (ex) {
      await this.pgClient.query('ROLLBACK');
      throw ex;
    }
  }

  async seed(data: Record<TableName, RowFactory[]>, ignorePrimaryKeys?: boolean): Promise<SeedRegistry>;
  async seed(tableName, rowFactory: RowFactory | RowFactoryGenerator, num?: number): Promise<TableRow[]>;
  async seed(...args: any[]): Promise<TableRow[] | SeedRegistry> {
    return typeof args[0] === 'object'
      ? this.seedMultiTable(args[0], args[1] ?? true)
      : this.seedTable(args[0], args[1], args[2] ?? 1);
  }

  async seedSpot(tableName, factoryData: any): Promise<TableRow> {
    this.seededRegistry = {}; // start fresh
    try {
      await this.pgClient.query('BEGIN');
      const row = await this.seedForeignRows(tableName, factoryData);
      await this.pgClient.query('COMMIT');
      return row;
    } catch (ex) {
      await this.pgClient.query('ROLLBACK');
      throw ex;
    }
  }

  async close() {
    await this.pgClient.end();
    this.pgClient = null;
    this.seededRegistry = {};
  }
}
