// Errors with CLI exit codes: 1 = error, 2 = QA failed, 3 = over budget (BudgetError in cost.mjs).
export class QaFail extends Error {
  constructor(msg, report) {
    super(msg);
    this.name = 'QaFail';
    this.code = 2;
    this.report = report;
  }
}
