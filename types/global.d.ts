import 'jest-extended';

declare global {
  namespace NodeJS {
    interface Global {
      expect: any;
    }
  }
}
