import { Seeder, SeederProps } from './Seeder';
import { Column, Db } from 'pg-structure';
import { formatForDB, formatGeometryTo, getRandomGeometry } from '../utils/geometry';
import { Client, ClientConfig } from 'pg';
import { WGS_SRID } from '../constants/spatial';
import { BBox } from '@turf/helpers';
import { invariant } from '../utils';
import { TableRow, GeometryFormat, GeometryType, GeometryColumnType } from '../types';

export interface PostgisSeederProps extends SeederProps {
  /**
   * SRID of input/output geometry (LatLng 4326 by default)
   */
  sridOfIOGeometry?: number;
  /**
   * SRID of geometry in database (LatLng 4326 by default)
   */
  sridOfDBGeometry?: number;
  /**
   * BBox to bound random geometries. By default is unbounded.
   */
  bboxForRandomGeometry?: BBox;
  /**
   * Format of the geometry to return in (by default GeometryFormat.WKB)
   */
  formatOfReturningGeometry?: GeometryFormat;
}

export class PostgisSeeder extends Seeder {
  protected props: PostgisSeederProps;

  protected geometryColumnTypes: Record<string, Record<string, GeometryColumnType>>;

  constructor(
    pgClient: string | ClientConfig | Client,
    {
      sridOfIOGeometry = WGS_SRID,
      sridOfDBGeometry = WGS_SRID,
      bboxForRandomGeometry,
      formatOfReturningGeometry = GeometryFormat.HEXEWKB,
      ...props
    }: PostgisSeederProps = {}
  ) {
    super(pgClient, props);

    this.props = {
      ...this.props,
      sridOfIOGeometry,
      sridOfDBGeometry,
      bboxForRandomGeometry,
      formatOfReturningGeometry,
    };
  }

  protected async getStruct(): Promise<Db> {
    await super.getStruct();
    if (!this.geometryColumnTypes) {
      this.geometryColumnTypes = await this.getGeometryColumnTypes();
    }
    return this.struct;
  }

  protected async generateValue(col: Column) {
    switch (col.type.name) {
      case 'geometry':
        invariant(col.arrayDimension === 0, `ARRAY not supported for ${col.type.name} columns`);

        const { type, is3D, srid } = await this.getGeometryColumnType(col.table.name, col.name);
        const geom = formatForDB(
          getRandomGeometry(type as GeometryType, this.props.bboxForRandomGeometry),
          this.props.sridOfDBGeometry ?? srid
        );
        return is3D ? `ST_Force3D(${geom})` : geom;

      default:
        return super.generateValue(col);
    }
  }

  protected prepareValue(value: any) {
    const looksLikePostgisFn = typeof value === 'string' && /^ST_[^\(]+\(/i.test(value);
    if (looksLikePostgisFn) {
      return value;
    } else {
      return super.prepareValue(value);
    }
  }

  protected async processFactoryValue(col: Column, value: any) {
    value = await super.processFactoryValue(col, value);
    if (col.type.name === 'geometry') {
      if (value === null && !col.notNull) {
        return null;
      } else {
        let sridOfDBGeometry = this.props.sridOfDBGeometry;
        if (!sridOfDBGeometry) {
          const { srid } = await this.getGeometryColumnType(col.table.name, col.name);
          sridOfDBGeometry = srid;
        }
        return formatForDB(
          // make sure that geometry has an appropriate SRID
          formatGeometryTo(value, GeometryFormat.HEXEWKB, this.props.sridOfIOGeometry),
          sridOfDBGeometry
        );
      }
    } else {
      return value;
    }
  }

  private async getGeometryColumnTypes(): Promise<Record<string, Record<string, GeometryColumnType>>> {
    const result = await this.pgClient.query(`SELECT * FROM geometry_columns WHERE f_table_schema = 'public'`);
    if (result.rowCount > 0) {
      return result.rows.reduce((registry, row) => {
        if (!registry[row['f_table_name']]) {
          registry[row['f_table_name']] = {};
        }
        registry[row['f_table_name']][row['f_geometry_column']] = {
          type: row['type'].toUpperCase(),
          is3D: row['coord_dimension'] === 3,
          srid: row['srid'],
        };
        return registry;
      }, {});
    }
    return {};
  }

  private getGeometryColumnType(tableName, colName): GeometryColumnType {
    invariant(
      !!this.geometryColumnTypes[tableName]?.[colName],
      `getGeometryColumnType: ${tableName} has no GEOMETRY column ${colName}`
    );
    return this.geometryColumnTypes?.[tableName]?.[colName];
  }

  protected async insertRow(tableName, data: any = {}): Promise<TableRow> {
    const row = await super.insertRow(tableName, data);

    if (this.props.formatOfReturningGeometry !== GeometryFormat.HEXEWKB) {
      const tableSchema = await this.getTableSchema(tableName);
      let primaryKey;
      let hasGeometryCoumns = false;
      const columns = [];
      for (const col of tableSchema.columns) {
        let colName;
        if (col.type.name === 'geometry') {
          hasGeometryCoumns = true;
          switch (this.props.formatOfReturningGeometry) {
            case GeometryFormat.WKT:
              colName = `ST_asEWKT(ST_Transform(${col.name}, ${this.props.sridOfIOGeometry})) AS ${col.name}`;
              break;
            case GeometryFormat.GeoJSON:
              colName = `ST_asGeoJSON(ST_Transform(${col.name}, ${this.props.sridOfIOGeometry}), 9, 2)::json AS ${col.name}`;
              break;
          }
        } else {
          if (col.isPrimaryKey) {
            primaryKey = col.name;
          }
          colName = this.pgClient.escapeIdentifier(col.name);
        }
        columns.push(colName);
      }

      if (hasGeometryCoumns) {
        invariant(!!primaryKey, `${tableName} doesn't have a primary key, cannot retrieve a row`);

        const sql = this.prepareSql(`SELECT ${columns.join(', ')} FROM ${tableName} WHERE ${primaryKey} = $1`, [
          row[primaryKey],
        ]);
        const {
          rows: [lastRow],
        } = await this.pgClient.query(sql);
        return lastRow;
      }
    }

    return row;
  }
}
