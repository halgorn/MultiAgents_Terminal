import test from 'node:test';
import assert from 'node:assert/strict';
import { projectReportCss } from './project-report-style.js';

test('projectReportCss returns a non-empty string', () => {
  const css = projectReportCss('#ff0000');
  assert.ok(css.length > 0);
  assert.equal(typeof css, 'string');
});

test('projectReportCss interpolates gradeColor into .score rule', () => {
  const css = projectReportCss('#3fb950');
  assert.ok(css.includes('color:#3fb950'), 'gradeColor should appear in CSS');
});

test('projectReportCss with different colors produces different output', () => {
  const green = projectReportCss('#3fb950');
  const red = projectReportCss('#f85149');
  assert.notEqual(green, red);
});

test('projectReportCss includes nav sticky positioning', () => {
  const css = projectReportCss('#fff');
  assert.ok(css.includes('position:sticky'));
  assert.ok(css.includes('top:0'));
});

test('projectReportCss includes table styles', () => {
  const css = projectReportCss('#fff');
  assert.ok(css.includes('border-collapse:collapse'));
  assert.ok(css.includes('table-layout:auto'));
});

test('projectReportCss includes responsive media query', () => {
  const css = projectReportCss('#fff');
  assert.ok(css.includes('@media'));
  assert.ok(css.includes('max-width:900px'));
});

test('projectReportCss includes dark background', () => {
  const css = projectReportCss('#fff');
  assert.ok(css.includes('--bg:#09090b'));
});

test('projectReportCss .score block wraps gradeColor correctly', () => {
  const color = 'rgb(99,200,99)';
  const css = projectReportCss(color);
  assert.ok(css.includes(`color:${color}`), 'color must be inside .score rule');
});
