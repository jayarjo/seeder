export { camelCase, snakeCase } from 'change-case';

// NOTE: the way lodash case changing functions convert string with numbers in them is unacceptable
// so we handle that manually

// export const camelCase = (str: string) => {
//   str = camelCaseLodash(str);
//   // lodash will turn geometry_3d to geometry3D - we need to lower the char after the number back
//   // e.g. geometry_3d should become geometry3d
//   return str.replace(/\d+[^\d]/g, ($0) => $0.toLowerCase());
// };

// export const snakeCase = (str: string) => {
//   // lodash will turn geometry3d to geometry_3_d - we need to strip an underscore after the number
//   str = snakeCaseLodash(str);
//   return str.replace(/(\d)_/g, '$1');
// };
