jest.mock('file-saver', () => ({ saveAs: jest.fn() }));
jest.mock('jspdf', () => ({ jsPDF: jest.fn() }));
jest.mock('docx', () => ({ Document: jest.fn(), Packer: {}, Paragraph: jest.fn(), TextRun: jest.fn() }));
const { exportReport } = require('./exportUtils');
beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: jest.fn().mockResolvedValue() } });
  jest.spyOn(window, 'alert').mockImplementation(() => {});
  jest.spyOn(window, 'open').mockReturnValue({});
});
afterEach(() => { delete window.xhandleDesktop; jest.restoreAllMocks(); });
it('opens Google Docs through the desktop host without a false popup-blocked warning', async () => {
  window.xhandleDesktop = { openExternal: jest.fn().mockResolvedValue() };
  await exportReport('Report', 'gdocs');
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Report');
  expect(window.xhandleDesktop.openExternal).toHaveBeenCalledWith('https://docs.google.com/document/u/0/create');
  expect(window.open).not.toHaveBeenCalled();
  expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Markdown copied'));
});
it('preserves normal browser opening', async () => {
  await exportReport('Report', 'gdocs');
  expect(window.open).toHaveBeenCalledWith('https://docs.google.com/document/u/0/create', '_blank');
});
