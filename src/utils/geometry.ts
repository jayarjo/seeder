import isValidGeoJSON from '@turf/boolean-valid';
import { isEmptyObj, invariant } from '.';
import { Feature, Geometry, Position, Point, BBox, MultiPolygon, Polygon } from '@turf/helpers';
import explode from '@turf/explode';
import turfArea from '@turf/area';
import turfDifference from '@turf/difference';
import { WGS_SRID } from '../constants/spatial';
import { GeometryFormat, GeometryType, TableRow } from '../types';
import { point, polygon, lineString } from './geojson-random';
import wkx from 'wkx';
import { round } from 'lodash';

const isValidGeometry = (geom: any): geom is Feature<any> | Geometry =>
  typeof geom === 'object' && !isEmptyObj(geom) && isValidGeoJSON(geom);

export const areNumbersClose = (num1: number, num2: number, precision: number = 2): boolean => {
  // this comes directly from Jests toBeCloseTo matcher
  const acceptableDiff = Math.pow(10, -precision) / 2;
  const receivedDiff = Math.abs(num1 - num2);
  return receivedDiff < acceptableDiff;
};

const arePositionsClose = (pos1: Position, pos2: Position, precision: number = 2): boolean => {
  if (!pos1?.length || pos1.length !== pos2?.length) {
    return false;
  } else {
    return pos1.every((num, idx) => areNumbersClose(num, pos2[idx], precision));
  }
};

const arePointsClose = (point1: Point, point2: Point, precision): boolean =>
  arePositionsClose(point1.coordinates, point2.coordinates, precision);

export const areGeometriesClose = (geom1: Geometry, geom2: Geometry, precision: number = 7): boolean => {
  invariant(isValidGeometry(geom1), `areGeometriesClose: Invalid geometry passed as first argument`);
  invariant(isValidGeometry(geom2), `areGeometriesClose: Invalid geometry passed as second argument`);

  if (geom1?.type !== geom2?.type) {
    return false;
  } else {
    const { features: features1 } = explode(geom1);
    const { features: features2 } = explode(geom2);
    if (features1.length !== features2.length) {
      return false;
    } else {
      return features1.every((feature, idx) => arePointsClose(feature.geometry, features2[idx].geometry, precision));
    }
  }
};

export const arePolygonsEquivalent = (
  polygon1: Polygon | MultiPolygon,
  polygon2: Polygon | MultiPolygon,
  areaPrecision: number = -2,
  diffAreaPrecision?: number
): boolean => {
  invariant(
    ['Polygon', 'MultiPolygon'].includes(polygon1.type) && ['Polygon', 'MultiPolygon'].includes(polygon2.type),
    `areGeometriesEquivalent is applicable to Polygons or MultiPolygons only`
  );
  invariant(isValidGeometry(polygon1), `areGeometriesEquivalent: Invalid geometry passed as first argument`);
  invariant(isValidGeometry(polygon2), `areGeometriesEquivalent: Invalid geometry passed as second argument`);

  const area1 = turfArea(polygon1);
  const area2 = turfArea(polygon2);
  const difference = turfDifference(polygon1, polygon2);

  if (!difference) {
    return false;
  } else {
    return (
      areNumbersClose(area1, area2, areaPrecision) &&
      areNumbersClose(turfArea(difference.geometry), 0, diffAreaPrecision ?? areaPrecision)
    );
  }
};

export const formatGeometryTo = (
  geometry: string | Geometry,
  toFormat: GeometryFormat = GeometryFormat.GeoJSON,
  defaultSrid: number = WGS_SRID
) => {
  const fromFormat = getGeometryFormat(geometry);
  let geometryWKX;

  switch (fromFormat) {
    case GeometryFormat.WKT:
      geometryWKX = wkx.Geometry.parse(geometry as string);
      break;

    case GeometryFormat.HEXEWKB:
      geometryWKX = wkx.Geometry.parse(Buffer.from(geometry as string, 'hex'));
      break;

    case GeometryFormat.GeoJSON:
      // exposed parseGeoJSON has no way to disable assigning default 4326 srid to geometries that don't have their own
      // so we have to use this hack with "private" one
      geometryWKX = wkx.Geometry._parseGeoJSON(geometry, true);
      break;

    default:
      throw new Error(`changeFormatTo: geometry invalid or in unsupported format: ${fromFormat}`);
  }

  // make sure that geometry has srid
  geometryWKX.srid = geometryWKX.srid || defaultSrid;

  switch (toFormat) {
    case GeometryFormat.WKT:
      return geometryWKX.toEwkt();

    case GeometryFormat.GeoJSON:
      return geometryWKX.toGeoJSON({ shortCrs: true });

    case GeometryFormat.HEXEWKB:
      return geometryWKX
        .toEwkb()
        .toString('hex')
        .toUpperCase();

    default:
      throw new Error(`changeFormatTo: toFormat should be one of ${Object.values(GeometryFormat).join(', ')}`);
  }
};

export const formatForDB = (geometry: string | Geometry, sridOfDB: number = WGS_SRID): string => {
  const format = getGeometryFormat(geometry);
  let geomStr;
  switch (format) {
    case GeometryFormat.WKT:
      geomStr = `ST_GeomFromText('${geometry}')`;
      break;

    case GeometryFormat.HEXEWKB:
      geomStr = `'${geometry}'::geometry`;
      break;

    case GeometryFormat.GeoJSON:
      geomStr = `ST_GeomFromGeoJSON('${JSON.stringify(geometry)}')`;
      break;

    default:
      throw new Error(`formatForDB: geometry invalid or in unsupported format: ${format}`);
  }

  if (sridOfDB) {
    if (sridOfDB !== getGeometrySRID(geometry)) {
      return `ST_Transform(${geomStr}, ${sridOfDB})`;
    } else {
      // make sure that SRID is set
      return `ST_SetSRID(${geomStr}, ${sridOfDB})`;
    }
  } else {
    return geomStr;
  }
};

export const addCRSProperty = (geojson, srid) => ({
  ...geojson,
  crs: { type: 'name', properties: { name: `EPSG:${srid}` } },
});



export const polygonToMultipolygon = (geometry: Polygon | MultiPolygon): MultiPolygon =>
  geometry?.type === 'Polygon'
    ? {
        ...geometry,
        type: 'MultiPolygon',
        coordinates: [geometry.coordinates],
      }
    : geometry;

export const multipolygonToPolygon = (geometry: Polygon | MultiPolygon): Polygon =>
  geometry?.type === 'MultiPolygon'
    ? {
        ...geometry,
        type: 'Polygon',
        coordinates: geometry.coordinates[0],
      }
    : geometry;

export const getRandomGeometry = (type: GeometryType, bbox?: BBox, addCRS = true): Geometry => {
  let geometry;
  switch (type) {
    case 'LINESTRING':
      geometry = lineString(1, undefined, 0.01, undefined, bbox).features[0].geometry;
      break;

    case 'POLYGON':
      geometry = polygon(1, undefined, undefined, bbox).features[0].geometry;
      break;

    case 'MULTIPOLYGON':
      geometry = polygonToMultipolygon(polygon(1, undefined, undefined, bbox).features[0].geometry);
      break;

    case 'GEOMETRY':
    case 'POINT':
    default:
      geometry = point(1, bbox).features[0].geometry;
  }
  return addCRS ? addCRSProperty(geometry, WGS_SRID) : geometry;
};

const HEXEWKB_RE = new RegExp(`^[0-9A-F]+$`);
const WKT_RE = new RegExp(`(?:${Object.values(GeometryType).join('|')})\\([\\(\\,\\.\\d\\-\\s\\)]+\\)$`);

export const getGeometryFormat = (geometry: string | Geometry): GeometryFormat => {
  if (typeof geometry === 'string') {
    if (HEXEWKB_RE.test(geometry)) {
      return GeometryFormat.HEXEWKB;
    } else if (WKT_RE.test(geometry)) {
      return GeometryFormat.WKT;
    }
  } else if (Object.keys(GeometryType).includes(geometry?.type)) {
    return GeometryFormat.GeoJSON;
  }
  throw new Error(`getGeometryFormat: Geometry should be one of: ${Object.keys(GeometryFormat).join(', ')}`);
};

export const getGeometrySRID = (geometry: any, defaultSrid = WGS_SRID): number => {
  const format = getGeometryFormat(geometry);
  let srid;
  switch (format) {
    case GeometryFormat.WKT:
      srid = geometry.match(/^SRID=(\d+);/)?.[1] ?? null;
      break;
    case GeometryFormat.GeoJSON:
      if (geometry.crs?.type === 'name' && /^EPSG:(\d+)$/.test(geometry.crs?.properties?.name)) {
        srid = geometry.crs?.properties?.name.split(':')[1];
      }
      break;
    case GeometryFormat.HEXEWKB:
      const hexewkb = wkx.Geometry.parse(Buffer.from(geometry, 'hex'));
      srid = hexewkb.srid;
      break;
  }
  return srid ? +srid : defaultSrid;
};

export const roundCoordinates = (geometry: any, precision: number) => {
  const roundValue = (value: number | number[]) =>
    Array.isArray(value) ? value.map(roundValue) : round(value, precision);

  return {
    ...geometry,
    coordinates: roundValue(geometry.coordinates),
  };
};
