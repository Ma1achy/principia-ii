/**
 * Editor Themes
 * Atom One Light and One Dark themes
 */

import { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { oneDark } from '@codemirror/theme-one-dark';

/**
 * Atom One Light Theme
 * Popular light theme from Atom editor
 */
export const atomOneLight: Extension = [
  EditorView.theme({
    '&': {
      backgroundColor: '#fafafa',
      color: '#383a42'
    },
    '.cm-content': {
      caretColor: '#526fff'
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: '#526fff'
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: '#526fff30'
    },
    '.cm-activeLine': {
      backgroundColor: '#2c313c14'
    },
    '.cm-selectionMatch': {
      backgroundColor: '#e5e5e6'
    },
    '.cm-gutters': {
      backgroundColor: '#fafafa',
      color: '#9d9d9f',
      border: 'none'
    },
    '.cm-activeLineGutter': {
      backgroundColor: '#e3e3e4'
    },
    '.cm-foldPlaceholder': {
      backgroundColor: '#e3e3e4',
      border: 'none',
      color: '#9d9d9f'
    },
    '.cm-tooltip': {
      border: '1px solid #d4d4d4',
      backgroundColor: '#fafafa'
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: '#d7d4f0',
      color: '#383a42'
    }
  }, { dark: false }),
  
  syntaxHighlighting(HighlightStyle.define([
    { tag: t.keyword, color: '#a626a4' },
    { tag: [t.name, t.deleted, t.character, t.macroName], color: '#383a42' },
    { tag: [t.propertyName], color: '#e45649' },
    { tag: [t.processingInstruction, t.string, t.inserted], color: '#50a14f' },
    { tag: [t.variableName], color: '#e45649' },
    { tag: [t.function(t.variableName)], color: '#4078f2' },
    { tag: [t.labelName], color: '#383a42' },
    { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: '#986801' },
    { tag: [t.definition(t.name)], color: '#c18401' },
    { tag: [t.separator], color: '#383a42' },
    { tag: [t.brace], color: '#383a42' },
    { tag: [t.annotation], color: '#ca1243' },
    { tag: [t.number, t.changed, t.annotation, t.modifier, t.self, t.namespace], color: '#986801' },
    { tag: [t.typeName, t.className], color: '#c18401' },
    { tag: [t.operator, t.operatorKeyword], color: '#0184bc' },
    { tag: [t.tagName], color: '#e45649' },
    { tag: [t.squareBracket], color: '#383a42' },
    { tag: [t.angleBracket], color: '#383a42' },
    { tag: [t.attributeName], color: '#986801' },
    { tag: [t.regexp], color: '#50a14f' },
    { tag: [t.quote], color: '#383a42' },
    { tag: [t.string], color: '#50a14f' },
    { tag: t.link, color: '#4078f2', textDecoration: 'underline' },
    { tag: [t.url, t.escape, t.special(t.string)], color: '#0184bc' },
    { tag: [t.meta], color: '#383a42' },
    { tag: [t.comment], color: '#a0a1a7', fontStyle: 'italic' },
    { tag: t.monospace, color: '#383a42' },
    { tag: t.strong, fontWeight: 'bold', color: '#e45649' },
    { tag: t.emphasis, fontStyle: 'italic', color: '#a626a4' },
    { tag: t.strikethrough, textDecoration: 'line-through' },
    { tag: t.heading, fontWeight: 'bold', color: '#e45649' },
    { tag: [t.heading1, t.heading2, t.heading3, t.heading4], fontWeight: 'bold', color: '#e45649' },
    { tag: [t.heading5, t.heading6], color: '#e45649' },
    { tag: [t.atom, t.bool, t.special(t.variableName)], color: '#986801' },
    { tag: [t.processingInstruction, t.inserted], color: '#50a14f' },
    { tag: [t.contentSeparator], color: '#0184bc' },
    { tag: t.invalid, color: '#e45649', borderBottom: '1px dotted #ca1243' }
  ]))
];

/**
 * Atom One Dark Theme (re-exported from official package)
 */
export { oneDark };
