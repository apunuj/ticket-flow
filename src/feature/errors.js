export class ContractError extends Error {
  constructor(diagnostics) {
    super(diagnostics.map(d => d.path + ': ' + d.message).join('; '));
    this.name = 'ContractError';
    this.diagnostics = diagnostics;
  }
}
export function invalid(code, path, message) {
  throw new ContractError([{ code, path, message }]);
}
export const pointer = (key) => String(key).replace(/~/g, '~0').replace(/\//g, '~1');
