import { isObject, isArray, mapKeys, mapValues } from 'lodash';
import * as caseMethods from './case';
import { ColumnCase } from '../types';
import { omitBy } from 'lodash';

export function invariant(expr: any, message: string): asserts expr {
  if (!expr) {
    throw new Error(message);
  }
}

export const wait = async (ms: number): Promise<void> => new Promise((resolve) => setTimeout(() => resolve(), ms));

export type Empty = undefined | null | false | '';

export const isEmptyString = (value: any): value is string => typeof value === 'string' && value.trim() === '';

export const isEmptyObj = (obj: Object): boolean => {
  if (typeof obj !== 'object') {
    return isEmpty(obj);
  } else {
    for (let key in obj) {
      if (obj.hasOwnProperty(key)) {
        return false;
      }
    }
    return true;
  }
};

export const isEmptyArray = <T>(value: Array<T>): boolean =>
  isEmpty(value) || (Array.isArray(value) && value.length === 0);

export const isEmpty = <T>(value: T | Empty): value is Empty =>
  value === undefined || value === null || value === false || isEmptyString(value);

export const changeKeyCase = (obj: any, method: ColumnCase, ignoreKeys: string[] = []): any => {
  const caseMethod = typeof method === 'function' ? method : caseMethods[method];
  return mapKeys(obj, (_, key) => (ignoreKeys.includes(key) ? key : caseMethod(key)));
};

export const changeKeyCaseDeep = (obj: any, method: ColumnCase, ignoreKeys: string[] = []): any => {
  const caseMethod = typeof method === 'function' ? method : caseMethods[method];
  return mapKeys(
    mapValues(obj, (value) =>
      isObject(value) && !isArray(value) ? changeKeyCaseDeep(value, method, ignoreKeys) : value
    ),
    (_, key) => (ignoreKeys.includes(key) ? key : caseMethod(key))
  );
};

/**
 * Takes an object and returns its clone, without any Date props
 * @param obj
 */
export const omitDates = (obj: Record<string, any>) => omitBy(obj, (value: any) => value instanceof Date);

/**
 * Returns a function, that will return next item from the given array every time it is called
 * @param arr
 */
export const handOut = (arr: any[]) => {
  let i = 0;
  const length = arr.length;
  return () => arr[i++ % length];
};

export const areDatesSimilar = (date1: Date, date2: Date, deltaMs: number = 500) => {
  return Math.abs(date1.getTime() - date2.getTime()) <= deltaMs;
};

export const arrayToObj = (arr: string[]) => arr.reduce((obj, name) => ({ ...obj, [name]: {} }), {});
