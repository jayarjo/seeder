// adapted from https://www.npmjs.com/package/geojson-random
import { FeatureCollection, Point, LineString, Polygon, BBox, Position } from 'geojson';

function vertexToCoordinate(hub) {
  return function(cur) {
    return [cur[0] + hub[0], cur[1] + hub[1]];
  };
}

function rnd() {
  return Math.random() - 0.5;
}
function lon() {
  return rnd() * 360;
}
function lat() {
  return rnd() * 180;
}

function coordInBBBOX(bbox) {
  return [Math.random() * (bbox[2] - bbox[0]) + bbox[0], Math.random() * (bbox[3] - bbox[1]) + bbox[1]];
}

function geometry(type: 'Polygon' | 'LineString' | 'Point', coordinates) {
  switch (type) {
    case 'Point':
      return {
        type: 'Point',
        coordinates: coordinates,
      };
    case 'LineString':
      return {
        type: 'LineString',
        coordinates: coordinates,
      };
    case 'Polygon':
      return {
        type: 'Polygon',
        coordinates: coordinates,
      };
    default:
      throw new Error('Currently only Point, LineString adn Polygon types are supported');
  }
}

function feature(geom) {
  return {
    type: 'Feature',
    geometry: geom,
    properties: {},
  };
}

function collection(f) {
  return {
    type: 'FeatureCollection',
    features: f,
  };
}

export const position = function position(bbox?: BBox): Position {
  if (bbox) return coordInBBBOX(bbox);
  else return [lon(), lat()];
};

export const point = function(count: number, bbox?: BBox): FeatureCollection<Point> {
  const features = [];
  for (let i = 0; i < count; i++) {
    features.push(feature(bbox ? geometry('Point', position(bbox)) : geometry('Point', [lon(), lat()])));
  }
  return collection(features);
};

export const polygon = function(
  count: number,
  numVertices?: number,
  maxRadialLength?: number,
  bbox?: BBox
): FeatureCollection<Polygon> {
  if (typeof numVertices !== 'number') numVertices = 10;
  if (typeof maxRadialLength !== 'number') maxRadialLength = 10;
  const features = [];
  for (let i = 0; i < count; i++) {
    let vertices = [];
    const circleOffsets = Array.apply(null, new Array(numVertices + 1)).map(Math.random);

    circleOffsets.forEach(function sumOffsets(cur, index, arr) {
      arr[index] = index > 0 ? cur + arr[index - 1] : cur;
    });
    circleOffsets.forEach(function scaleOffsets(cur) {
      cur = (cur * 2 * Math.PI) / circleOffsets[circleOffsets.length - 1];
      const radialScaler = Math.random();
      vertices.push([radialScaler * maxRadialLength * Math.sin(cur), radialScaler * maxRadialLength * Math.cos(cur)]);
    });
    vertices[vertices.length - 1] = vertices[0]; // close the ring

    // center the polygon around something
    vertices = vertices.map(vertexToCoordinate(position(bbox)));
    features.push(feature(geometry('Polygon', [vertices])));
  }

  return collection(features);
};

export const lineString = function(
  count: number,
  numVertices?: number,
  maxLength?: number,
  maxRotation?: number,
  bbox?: BBox
): FeatureCollection<LineString> {
  if (typeof numVertices !== 'number' || numVertices < 2) numVertices = 10;
  if (typeof maxLength !== 'number') maxLength = 0.0001;
  if (typeof maxRotation !== 'number') maxRotation = Math.PI / 8;

  const features = [];
  for (let i = 0; i < count; i++) {
    const startingPoint = position(bbox);
    const vertices = [startingPoint];
    for (let j = 0; j < numVertices - 1; j++) {
      const priorAngle =
        j === 0
          ? Math.random() * 2 * Math.PI
          : Math.tan((vertices[j][1] - vertices[j - 1][1]) / (vertices[j][0] - vertices[j - 1][0]));
      const angle = priorAngle + (Math.random() - 0.5) * maxRotation * 2;
      const distance = Math.random() * maxLength;
      vertices.push([vertices[j][0] + distance * Math.cos(angle), vertices[j][1] + distance * Math.sin(angle)]);
    }
    features.push(feature(geometry('LineString', vertices)));
  }

  return collection(features);
};
