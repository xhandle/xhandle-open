import palette from './palette.json';
import theme from './tailwindTheme.cjs';
import fs from 'fs';
import colors from 'tailwindcss/colors';
const luminance=hex=>hex.slice(1).match(/../g).map(value=>parseInt(value,16)/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4).reduce((sum,n,i)=>sum+n*[.2126,.7152,.0722][i],0);
const contrast=(a,b)=>(Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);
test.each(['light','dark'])('%s semantic text, statuses and focus meet contrast targets',mode=>{
 const p=palette[mode];for(const foreground of ['text','muted','subtle','link'])for(const background of ['canvas','panel','surface','raised','inset'])expect(contrast(p[foreground],p[background])).toBeGreaterThanOrEqual(4.5);
 for(const role of ['info','success','warning','danger'])expect(contrast(p[role+'Text'],p[role])).toBeGreaterThanOrEqual(4.5);
 expect(contrast(p.selectedText,p.selected)).toBeGreaterThanOrEqual(4.5);expect(contrast(p.focus,p.surface)).toBeGreaterThanOrEqual(3);expect(contrast(p.controlBorder,p.field)).toBeGreaterThanOrEqual(3);
});
test('utility color roles retain opacity support and do not remap authored SVG paint',()=>{
 expect(theme.backgroundColor.white).toContain('<alpha-value>');expect(theme.textColor.gray[900]).toContain('--x-text-gray-900');expect(theme.borderColor.slate[300]).toContain('--x-border-slate-300');expect(theme.colors).toBeUndefined();
 const css=fs.readFileSync('src/index.css','utf8');expect(css).not.toMatch(/\.dark\s+\.react-flow__edge-path/);expect(css).not.toMatch(/\.dark\s+\.react-flow__node\s*\{/);
});
test('first-paint appearance loads before renderer scripts and remains external for CSP',()=>{
 const html=fs.readFileSync('public/index.html','utf8');expect(html.indexOf('theme-init.js')).toBeLessThan(html.indexOf('</head>'));expect(html).toContain('src="%PUBLIC_URL%/theme-init.js"');
});

const channels=hex=>hex.slice(1).match(/../g).map(value=>parseInt(value,16));
const hexFromChannels=value=>'#'+value.split(' ').map(n=>Number(n).toString(16).padStart(2,'0')).join('');
const chroma=hex=>(Math.max(...channels(hex))-Math.min(...channels(hex)))/255;
test.each(['blue','sky','cyan','indigo','violet','purple','fuchsia'])('%s action backgrounds stay muted and readable in dark mode, preserving original light colors',family=>{
 for(const shade of [500,600,700,800,900,950]) {
  const name=`--x-bg-${family}-${shade}`;
  const dark=hexFromChannels(theme.variables.dark[name]);
  expect(chroma(dark)).toBeLessThanOrEqual(.30);
  expect(luminance(dark)).toBeLessThan(.16);
  expect(contrast('#ffffff',dark)).toBeGreaterThanOrEqual(4.5);
  expect(hexFromChannels(theme.variables.light[name])).toBe(colors[family][shade]);
  expect(theme.backgroundColor[family][shade]).toContain('<alpha-value>');
 }
 expect(theme.variables.dark[`--x-bg-${family}-700`]).not.toBe(theme.variables.dark[`--x-bg-${family}-600`]);
});
test('chat prompts have a quiet dark surface, readable text and the original light bubble color',()=>{
 expect(palette.light.promptBubble).toBe(colors.indigo[600]);expect(palette.light.promptText).toBe('#ffffff');
 for(const mode of ['light','dark'])expect(contrast(palette[mode].promptText,palette[mode].promptBubble)).toBeGreaterThanOrEqual(4.5);
 expect(luminance(palette.dark.promptBubble)).toBeLessThan(luminance(palette.dark.actionPurple));
 expect(chroma(palette.dark.promptBubble)).toBeLessThan(.15);
});
test('shared and component-specific action tokens stay muted and readable, including hover',()=>{
 for(const name of ['actionBlue','actionBlueHover','actionPurple','actionPurpleHover','brandPurpleAction','artifactAction','traceAction']) {
  expect(chroma(palette.dark[name])).toBeLessThanOrEqual(.30);
  expect(luminance(palette.dark[name])).toBeLessThan(.16);
  expect(contrast('#ffffff',palette.dark[name])).toBeGreaterThanOrEqual(4.5);
 }
});
