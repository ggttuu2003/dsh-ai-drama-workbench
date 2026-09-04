import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { Workbench } from './original-workbench.tsx'
import ORIGINAL_WORKBENCH_STYLES from './original-workbench.css'

const STYLE_ID = 'dsh-ai-drama-workbench-shell-style'

// Only the small Harness integration shell lives in the page document. The
// original workbench styles are rendered inside a shadow root below.
const SHELL_STYLES = `
.adw-standard-launch { position: fixed; z-index: 1; top: 14px; right: 18px; height: 29px; border: 1px solid rgba(32,32,29,.14); border-radius: 5px; background: #fff; color: #20201d; padding: 0 9px; cursor: pointer; font: 600 12px "PingFang SC", "Hiragino Sans GB", sans-serif; box-shadow: 0 3px 12px rgba(32,32,29,.05); }
.adw-standard-launch:hover { background: #f8f8f6; }
.adw-standard-launch:focus-visible, .adw-tools-fab:focus-visible, .adw-tools-menu button:focus-visible { outline: 2px solid rgba(32,32,29,.3); outline-offset: 2px; }
.adw-workbench-overlay { position: fixed; z-index: 20; inset: 0; display: flex; width: 100vw; height: 100dvh; min-width: 0; min-height: 0; overflow: hidden; background: #fff; pointer-events: auto; }
.adw-workbench-shadow-host { display: block; flex: 1; width: 100%; height: 100%; min-width: 0; min-height: 0; overflow: auto; scrollbar-width: none; background: #fff; }
.adw-workbench-shadow-host::-webkit-scrollbar { display: none; }
.adw-workbench-load-error { display: grid; place-items: center; flex: 1; min-width: 0; padding: 28px; color: #20201d; font: 13px/1.6 "PingFang SC", "Hiragino Sans GB", sans-serif; text-align: center; }
.adw-workbench-load-error strong, .adw-workbench-load-error span { display: block; }.adw-workbench-load-error span { max-width: 540px; margin-top: 6px; color: rgba(32,32,29,.68); }
.adw-top-tools { position: fixed; z-index: 65; top: 12px; left: calc(50% + 132px); display: flex; gap: 5px; align-items: center; }
.adw-top-tool-button { display: inline-flex; align-items: center; gap: 5px; height: 29px; border: 1px solid rgba(32,32,29,.16); border-radius: 5px; background: rgba(255,255,255,.96); color: rgba(32,32,29,.72); padding: 0 8px; cursor: pointer; font: 600 11px "PingFang SC", "Hiragino Sans GB", sans-serif; white-space: nowrap; }.adw-top-tool-button:hover { border-color: rgba(32,32,29,.42); color: #20201d; }.adw-top-tool-button > span { font-size: 12px; }.adw-top-tool-button small { color: rgba(32,32,29,.5); font-size: 10px; }.adw-ssh-tool.is-connected::before, .adw-ssh-tool.is-error::before { content: ""; width: 5px; height: 5px; border-radius: 50%; background: rgba(32,32,29,.68); }
.adw-ssh-backdrop { position: fixed; z-index: 85; inset: 0; display: grid; place-items: center; background: rgba(32,32,29,.22); padding: 20px; }.adw-ssh-panel { width: min(620px,100%); border: 1px solid rgba(32,32,29,.18); border-radius: 8px; background: #fff; box-shadow: 0 18px 54px rgba(32,32,29,.22); padding: 20px; color: #20201d; font-family: "PingFang SC", "Hiragino Sans GB", sans-serif; }.adw-ssh-heading { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid rgba(32,32,29,.12); padding-bottom: 14px; }.adw-ssh-heading small { color: rgba(32,32,29,.5); font-size: 11px; }.adw-ssh-heading h2 { margin: 3px 0 0; font-size: 20px; }.adw-ssh-heading button { width: 26px; height: 26px; border: 1px solid rgba(32,32,29,.16); border-radius: 5px; background: #fff; font-size: 18px; cursor: pointer; }.adw-ssh-status { display: flex; gap: 9px; align-items: center; margin: 16px 0; padding: 10px; border: 1px solid rgba(32,32,29,.12); border-radius: 6px; background: #f8f8f6; }.adw-ssh-status i { width: 8px; height: 8px; flex: 0 0 auto; border-radius: 50%; background: rgba(32,32,29,.38); }.adw-ssh-status.is-connected i { background: #2f7d4b; }.adw-ssh-status.is-error i { background: #b94b4b; }.adw-ssh-status div { display: grid; gap: 1px; }.adw-ssh-status strong { font-size: 12px; }.adw-ssh-status span { color: rgba(32,32,29,.58); font-size: 11px; }.adw-ssh-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }.adw-ssh-field { display: grid; gap: 4px; }.adw-ssh-field.is-wide { grid-column: 1 / -1; }.adw-ssh-field span { color: rgba(32,32,29,.58); font-size: 11px; }.adw-ssh-field input { min-width: 0; height: 34px; border: 1px solid rgba(32,32,29,.18); border-radius: 5px; background: #fff; padding: 0 9px; color: #20201d; font: 12px "SFMono-Regular", Consolas, monospace; }.adw-ssh-error { margin: 12px 0 0; color: #a33; font-size: 11px; }.adw-ssh-actions { display: flex; justify-content: flex-end; gap: 7px; margin-top: 18px; }.adw-ssh-actions button { height: 31px; border: 1px solid rgba(32,32,29,.18); border-radius: 5px; background: #fff; color: rgba(32,32,29,.72); padding: 0 10px; cursor: pointer; font: 600 11px "PingFang SC", "Hiragino Sans GB", sans-serif; }.adw-ssh-actions .is-primary { background: #20201d; border-color: #20201d; color: #fff; }.adw-ssh-actions .is-danger { color: #a33; }.adw-ssh-actions button:disabled { cursor: not-allowed; opacity: .55; }
.adw-exit-fab { align-items: center; display: inline-flex; gap: 6px; position: fixed; z-index: 65; right: 14px; bottom: 14px; min-height: 36px; border: 1px solid rgba(32,32,29,.22); border-radius: 7px; background: rgba(255,255,255,.96); box-shadow: 0 7px 18px rgba(32,32,29,.09); color: #20201d; padding: 0 11px; cursor: pointer; font: 650 12px "PingFang SC", "Hiragino Sans GB", sans-serif; }
.adw-exit-fab:hover { border-color: #20201d; background: #fff; }.adw-exit-fab-mark { font-size: 15px; line-height: 1; transform: translateY(-.5px); }
body[data-ai-drama-generation="open"] .adw-top-tools, body[data-ai-drama-generation="open"] .adw-exit-fab { opacity: 0; pointer-events: none; visibility: hidden; }
.adw-chat-hint { position: absolute; z-index: 70; bottom: 110px; left: 14px; width: min(330px,calc(100vw - 28px)); border: 1px solid rgba(32,32,29,.14); border-radius: 8px; background: #fff; box-shadow: 0 10px 26px rgba(32,32,29,.14); color: rgba(32,32,29,.72); padding: 10px; font: 12px/1.5 "PingFang SC", "Hiragino Sans GB", sans-serif; }
.adw-chat-hint button { display: block; border: 0; background: transparent; color: #20201d; margin-top: 6px; padding: 0; cursor: pointer; font: 650 11px "PingFang SC", "Hiragino Sans GB", sans-serif; text-decoration: underline; text-underline-offset: 3px; }
body[data-ai-drama-workbench="open"] [data-slot="conversation"] > * { position: fixed !important; z-index: 30; top: 50%; left: 50%; width: min(920px,calc(100vw - 48px)); height: min(680px,calc(100vh - 64px)) !important; min-width: 0; max-height: calc(100vh - 64px); overflow: hidden; border: 1px solid rgba(32,32,29,.14); border-radius: 12px; background: var(--dsw-alias-bg-base,#fff); box-shadow: 0 18px 54px rgba(32,32,29,.22); opacity: 0; visibility: hidden; pointer-events: none; transform: translate(-50%,-50%); transition: opacity 160ms ease, visibility 160ms ease; }
body[data-ai-drama-workbench="open"][data-ai-drama-chat="open"] [data-slot="conversation"] > * { opacity: 1; visibility: visible; pointer-events: auto; }
.adw-chat-close { align-items: center; border: 1px solid rgba(32,32,29,.18); border-radius: 999px; background: #20201d; box-shadow: 0 8px 20px rgba(32,32,29,.18); color: #fff; cursor: pointer; display: inline-flex; font: 650 11px "PingFang SC", "Hiragino Sans GB", sans-serif; gap: 6px; height: 30px; padding: 0 10px; position: fixed; right: max(18px,calc(50% - min(460px,calc(50vw - 24px)) + 10px)); top: max(14px,calc(50% - min(340px,calc(50vh - 32px)) + 10px)); z-index: 75; }.adw-chat-close:hover { background: #000; }.adw-chat-close-mark { font-size: 16px; font-weight: 400; line-height: 1; transform: translateY(-.5px); }
@media (max-width: 920px) { .adw-top-tools { left: auto; right: 142px; }.adw-top-tool-button small { display: none; } } @media (max-width: 720px) { .adw-standard-launch { top: 10px; right: 10px; }.adw-top-tools { top: 10px; right: 12px; }.adw-top-tool-button { padding: 0 6px; }.adw-top-tool-button span { display: none; }.adw-exit-fab { right: 12px; bottom: 12px; }.adw-chat-hint { bottom: 108px; left: 12px; width: calc(100vw - 24px); }.adw-chat-close { right: 20px; top: max(14px,calc(50% - min(300px,calc(50vh - 22px)) + 10px)); }.adw-ssh-grid { grid-template-columns: 1fr; }.adw-ssh-field.is-wide { grid-column: auto; }.adw-ssh-actions { flex-wrap: wrap; } body[data-ai-drama-workbench="open"] [data-slot="conversation"] > * { top: 50%; left: 50%; width: calc(100vw - 24px); height: min(600px,calc(100vh - 44px)) !important; max-height: calc(100vh - 44px); transform: translate(-50%,-50%); } }
.adw-ssh-tool.is-connected::before, .adw-ssh-tool.is-error::before { background: rgba(32,32,29,.68); }
.adw-ssh-status.is-connected i, .adw-ssh-status.is-error i { background: rgba(32,32,29,.68); }
.adw-ssh-error, .adw-ssh-actions .is-danger { color: rgba(32,32,29,.78); }
.adw-ssh-actions .is-sync { margin-right: auto; }
`

const SHADOW_HOST_STYLES = `
:host { display: block; min-height: 100%; background: #fff; color-scheme: light; }
.adw-original-workbench-mount { min-height: 100%; }
.project-structure-actions { display: flex; gap: 4px; }
.generation-open-button { border-color: var(--border-strong); }
.generation-modal { background: var(--paper); display: grid; grid-template-rows: auto minmax(0, 1fr) auto; max-height: min(780px, calc(100vh - 32px)); overflow: hidden; padding: 0; width: min(920px, calc(100vw - 48px)); }
.generation-modal-heading { background: var(--paper); border-bottom: 1px solid var(--border); margin: 0; padding: 21px 24px 17px; }
.generation-modal-heading .eyebrow { margin: 0; }.generation-modal-heading h2 { margin-top: 4px; }
.generation-modal-body { min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 18px 24px 22px; scrollbar-color: var(--border-strong) transparent; scrollbar-width: thin; }
.generation-asset-strip { align-items: center; background: var(--ash); border: 1px solid var(--border); border-radius: var(--radius-md); display: flex; gap: 18px; justify-content: space-between; min-height: 76px; padding: 13px 14px; }
.generation-asset-strip-copy { display: grid; gap: 2px; min-width: 0; }.generation-asset-strip-copy > span, .generation-card-kicker { color: var(--text-muted); font-size: 10px; font-weight: 650; letter-spacing: .06em; line-height: 1.2; text-transform: uppercase; }.generation-asset-strip-copy strong { color: var(--text); font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.generation-asset-strip-copy small { color: var(--text-secondary); font-size: 11px; line-height: 1.45; }
.generation-output-kind { align-items: center; border: 1px solid var(--border-strong); border-radius: 999px; color: var(--text-secondary); display: inline-flex; flex: 0 0 auto; font-size: 11px; font-weight: 600; min-height: 25px; padding: 0 9px; white-space: nowrap; }
.generation-loading { background: var(--ash); border: 1px solid var(--border); border-radius: var(--radius-md); color: var(--text-secondary); font-size: 12px; line-height: 1.55; margin: 14px 0 0; padding: 13px 14px; }
.generation-layout { align-items: start; display: grid; gap: 18px; grid-template-columns: minmax(0, 1.48fr) minmax(228px, .82fr); margin-top: 18px; }
.generation-main-column, .generation-side-column { align-content: start; display: grid; gap: 12px; min-width: 0; }
.generation-section, .generation-status-card, .generation-preset-card, .generation-preview, .generation-job-list { border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--paper); }
.generation-section { padding: 15px; }.generation-section-heading { align-items: flex-start; display: flex; gap: 12px; justify-content: space-between; }.generation-section-heading > div { display: grid; gap: 3px; }.generation-section-heading strong { color: var(--text); font-size: 13px; line-height: 1.3; }.generation-section-heading span { color: var(--text-muted); font-size: 11px; line-height: 1.45; }
.generation-task-settings { padding: 12px 15px; }.generation-task-settings .generation-form-grid { margin-top: 0; }.generation-inline-error { color: var(--text-secondary); font-size: 11px; margin: 9px 0 0; }
.generation-prompt-section { display: grid; gap: 10px; }.generation-prompt-section > .asset-field { margin: 0; }.generation-secondary-prompt { border-top: 1px solid var(--border); padding-top: 10px; }.generation-secondary-prompt summary { color: var(--text-secondary); cursor: pointer; font-size: 11px; font-weight: 600; list-style: none; }.generation-secondary-prompt summary::-webkit-details-marker { display: none; }.generation-secondary-prompt summary::after { border-bottom: 1px solid var(--text-secondary); border-right: 1px solid var(--text-secondary); content: ""; display: inline-block; height: 5px; margin-left: 8px; transform: translateY(-2px) rotate(45deg); width: 5px; }.generation-secondary-prompt[open] summary::after { transform: translateY(1px) rotate(225deg); }.generation-secondary-prompt .asset-field { margin-top: 10px; }
.generation-options { padding: 0; }.generation-options > summary { cursor: pointer; list-style: none; padding: 15px; }.generation-options > summary::-webkit-details-marker { display: none; }.generation-options > summary span { color: var(--text-muted); font-size: 11px; }.generation-options[open] > summary { border-bottom: 1px solid var(--border); }.generation-options > .generation-parameter-grid { margin: 14px 15px 0; }.generation-options > .asset-field { margin: 12px 15px 15px; }
.generation-form-grid { display: grid; gap: 12px; grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: 14px; }.generation-parameter-grid { display: grid; gap: 12px; grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: 14px; }.generation-parameter-grid.is-video { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.generation-prompt-fields { display: grid; gap: 12px; margin-top: 14px; }
.generation-advanced { border-top: 1px solid var(--border); margin-top: 15px; padding-top: 12px; }.generation-advanced summary { align-items: center; color: var(--text-secondary); cursor: pointer; display: flex; font-size: 11px; font-weight: 600; justify-content: space-between; list-style: none; }.generation-advanced summary::-webkit-details-marker { display: none; }.generation-advanced summary::after { border-bottom: 1.5px solid var(--text-secondary); border-right: 1.5px solid var(--text-secondary); content: ""; height: 6px; margin-left: 8px; transform: translateY(-2px) rotate(45deg); transition: transform 120ms ease; width: 6px; }.generation-advanced[open] summary::after { transform: translateY(2px) rotate(225deg); }.generation-advanced summary small { color: var(--text-muted); font-size: 11px; font-weight: 400; margin-left: auto; }.generation-advanced .asset-field { margin-top: 12px; }
.generation-mode-note { align-items: flex-start; background: var(--ash); border: 1px solid var(--border); border-radius: var(--radius-sm); display: grid; gap: 3px; margin-top: 14px; padding: 10px 11px; }.generation-mode-note strong { color: var(--text-secondary); font-size: 11px; font-weight: 650; }.generation-mode-note span { color: var(--text-muted); font-size: 11px; line-height: 1.55; }
.generation-status-card, .generation-preset-card { display: grid; gap: 6px; padding: 15px; }.generation-status-card { background: var(--ash); }.generation-status-card.is-ready { background: var(--paper); border-color: var(--border-strong); }.generation-status-card strong, .generation-preset-card strong { color: var(--text); font-size: 15px; line-height: 1.3; }.generation-status-card p, .generation-preset-card p { color: var(--text-secondary); font-size: 11px; line-height: 1.6; margin: 1px 0 0; }.generation-preset-card > div { border-top: 1px solid var(--border); display: flex; font-size: 11px; gap: 8px; justify-content: space-between; margin-top: 7px; padding-top: 10px; }.generation-preset-card > div span { color: var(--text-muted); }.generation-preset-card > div b { color: var(--text); font-weight: 600; text-align: right; }
.generation-config-path { border-top: 1px solid var(--border); color: var(--text-secondary); font-size: 11px; margin-top: 7px; padding-top: 9px; }.generation-config-path summary { cursor: pointer; font-weight: 600; list-style: none; }.generation-config-path summary::-webkit-details-marker { display: none; }.generation-config-path summary::before { content: "+"; display: inline-block; font-size: 14px; font-weight: 400; margin-right: 5px; }.generation-config-path[open] summary::before { content: "−"; }.generation-config-path code { background: var(--paper); border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--text-secondary); display: block; font-family: var(--mono); font-size: 10px; line-height: 1.55; margin-top: 9px; overflow-wrap: anywhere; padding: 7px; }
.generation-preview { margin-top: 14px; padding: 14px 15px; }.generation-preview.has-error { border-color: var(--border-strong); }.generation-result-heading { align-items: center; display: flex; gap: 12px; justify-content: space-between; }.generation-result-heading strong { color: var(--text); font-size: 13px; }.generation-result-heading span { color: var(--text-secondary); font-size: 11px; white-space: nowrap; }.generation-preview ul { display: grid; gap: 5px; list-style: none; margin: 11px 0 0; padding: 0; }.generation-preview li { align-items: baseline; border-top: 1px solid var(--border); display: grid; gap: 10px; grid-template-columns: minmax(72px, .34fr) minmax(0, 1fr); padding-top: 6px; }.generation-preview li span { color: var(--text-muted); font-size: 11px; }.generation-preview li b { color: var(--text-secondary); font-size: 11px; font-weight: 500; overflow-wrap: anywhere; }.generation-preview p { color: var(--text-secondary); font-size: 11px; line-height: 1.55; margin: 9px 0 0; }.generation-preview-error { background: var(--ash); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); color: var(--text); font-size: 12px; font-weight: 600; line-height: 1.55; margin: 14px 0 0; padding: 10px 11px; }
.generation-job-list { display: grid; gap: 8px; margin-top: 14px; padding: 14px 15px; }.generation-job-list > div { align-items: baseline; display: flex; justify-content: space-between; }.generation-job-list > div p { margin: 0; }.generation-job-list > div strong { color: var(--text-secondary); font-size: 12px; }.generation-job-list > article { align-items: center; border-top: 1px solid var(--border); display: grid; gap: 9px; grid-template-columns: 8px minmax(0, 1fr) auto; padding-top: 9px; }.generation-job-list article strong, .generation-job-list article small { display: block; }.generation-job-list article strong { color: var(--text); font-size: 12px; }.generation-job-list article small { color: var(--text-muted); display: -webkit-box; font-size: 11px; line-height: 1.45; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }.generation-job-list article em { color: var(--text-secondary); font-size: 11px; font-style: normal; }.generation-job-action { min-height: 28px; padding: 0 9px; white-space: nowrap; }.generation-job-dot { background: var(--ink-48); border-radius: 999px; height: 7px; width: 7px; }.generation-job-dot.is-completed { background: var(--ink); }.generation-job-dot.is-failed { background: var(--ink-72); }
.generation-modal-actions { background: var(--paper); border-top: 1px solid var(--border); margin: 0; padding: 14px 24px 16px; }
@media (max-width: 800px) { .generation-modal { max-height: calc(100dvh - 16px); width: min(680px, calc(100vw - 16px)); }.generation-modal-heading { padding: 17px 17px 14px; }.generation-modal-body { padding: 14px 17px 18px; }.generation-layout { grid-template-columns: 1fr; }.generation-side-column { grid-template-columns: repeat(2, minmax(0, 1fr)); }.generation-modal-actions { padding: 12px 17px 14px; } }
@media (max-width: 520px) { .generation-asset-strip { align-items: flex-start; min-height: 0; }.generation-asset-strip-copy small { display: none; }.generation-form-grid { grid-template-columns: 1fr; }.generation-side-column { grid-template-columns: 1fr; }.generation-modal-actions { gap: 6px; }.generation-modal-actions .text-button, .generation-modal-actions .submit-button { flex: 1 1 auto; padding: 0 9px; }.generation-modal-actions .text-button:first-child { flex: 0 0 auto; }.generation-job-list > article { grid-template-columns: 8px minmax(0, 1fr); }.generation-job-list article em, .generation-job-list article .generation-job-action { grid-column: 2; justify-self: start; } }
@media (max-width: 360px) { .generation-parameter-grid, .generation-parameter-grid.is-video { grid-template-columns: 1fr; }.generation-modal-heading h2 { font-size: 18px; }.generation-output-kind { display: none; } }
.adw-workbench-render-error { display: grid; min-height: 100vh; place-items: center; color: var(--text-secondary); padding: 28px; text-align: center; }
.adw-workbench-render-error strong, .adw-workbench-render-error span { display: block; }.adw-workbench-render-error span { margin-top: 6px; max-width: 520px; }
`

function shadowSafeStyles(source) {
  return `${source
    .replace(/^:root(?=\s*\{)/mu, ':host')
    .replace(/^html(?=\s*\{)/mu, ':host')
    .replace(/(^|\n)([\t ]*)body(?=\s*\{)/gu, '$1$2:host')}
${SHADOW_HOST_STYLES}`
}

const WORKBENCH_STYLES = shadowSafeStyles(ORIGINAL_WORKBENCH_STYLES)

function installStyles() {
  if (document.getElementById(STYLE_ID)) return () => {}
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.dataset.plugin = 'dsh-ai-drama-workbench'
  style.textContent = SHELL_STYLES
  document.head.appendChild(style)
  return () => style.remove()
}

function setWorkbenchMode(open, chatOpen = false) {
  document.body.dataset.aiDramaWorkbench = open ? 'open' : ''
  document.body.dataset.aiDramaChat = open && chatOpen ? 'open' : ''
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'object',
  'embed',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function isVisibleFocusable(element) {
  if (!(element instanceof HTMLElement) || element.matches('[disabled], [aria-hidden="true"]')) return false
  if (element.closest('[inert], [aria-hidden="true"]')) return false
  const style = window.getComputedStyle(element)
  return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0
}

function collectFocusableElements(roots) {
  const elements = []
  const seen = new Set()

  const addFocusable = element => {
    if (seen.has(element) || !isVisibleFocusable(element)) return
    seen.add(element)
    elements.push(element)
  }

  const visitRoot = root => {
    if (!root) return
    if (root instanceof HTMLElement && root.matches(FOCUSABLE_SELECTOR)) addFocusable(root)
    root.querySelectorAll?.(FOCUSABLE_SELECTOR).forEach(addFocusable)
    root.querySelectorAll?.('*').forEach(element => {
      if (element.shadowRoot) visitRoot(element.shadowRoot)
    })
  }

  roots.forEach(visitRoot)
  return elements
}

function isolateHarnessBackground(foregroundRoots) {
  const foreground = foregroundRoots.filter(Boolean)
  const isolated = []

  const collectBackgroundSiblings = parent => {
    Array.from(parent.children).forEach(element => {
      if (['SCRIPT', 'STYLE', 'LINK', 'META'].includes(element.tagName)) return
      if (foreground.some(root => root === element || root.contains(element))) return
      if (foreground.some(root => element.contains(root))) {
        collectBackgroundSiblings(element)
        return
      }
      isolated.push(element)
    })
  }

  collectBackgroundSiblings(document.body)
  const previous = isolated.map(element => ({
    ariaHidden: element.getAttribute('aria-hidden'),
    hadAriaHidden: element.hasAttribute('aria-hidden'),
    hadInert: element.hasAttribute('inert'),
    inert: element.inert,
    element,
  }))

  previous.forEach(({ element }) => {
    element.inert = true
    element.setAttribute('aria-hidden', 'true')
  })

  return () => {
    previous.reverse().forEach(({ ariaHidden, hadAriaHidden, hadInert, inert, element }) => {
      element.inert = inert
      if (hadInert) element.setAttribute('inert', '')
      else element.removeAttribute('inert')
      if (hadAriaHidden) element.setAttribute('aria-hidden', ariaHidden ?? 'true')
      else element.removeAttribute('aria-hidden')
    })
  }
}

class WorkbenchErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error) {
    console.error('[ai-drama-workbench] 原工作台渲染失败。', error)
  }

  render() {
    if (!this.state.error) return this.props.children
    return <section className="adw-workbench-render-error"><div><strong>工作台未能加载</strong><span>{this.state.error instanceof Error ? this.state.error.message : String(this.state.error)}</span></div></section>
  }
}

function ShadowWorkbench() {
  const hostRef = useRef(null)
  const [mountNode, setMountNode] = useState(null)
  const [mountError, setMountError] = useState(null)

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return undefined
    let mount
    try {
      const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' })
      mount = document.createElement('div')
      mount.className = 'adw-original-workbench-mount'
      shadow.replaceChildren(mount)
      setMountNode(mount)
    } catch (error) {
      console.error('[ai-drama-workbench] 无法初始化工作台隔离容器。', error)
      setMountError(error)
    }
    return () => {
      setMountNode(null)
      mount?.remove()
    }
  }, [])

  if (mountError) {
    return <section className="adw-workbench-load-error"><div><strong>工作台容器未能初始化</strong><span>{mountError instanceof Error ? mountError.message : String(mountError)}</span></div></section>
  }

  return <div className="adw-workbench-shadow-host" ref={hostRef}>
    {mountNode ? createPortal(<><style>{WORKBENCH_STYLES}</style><WorkbenchErrorBoundary><Workbench externalStructureTrigger /></WorkbenchErrorBoundary></>, mountNode) : null}
  </div>
}

function SshSettings({ connection, error, busy, syncing, onClose, onSave, onStart, onStop, onSync }) {
  const emptyConnection = { name: '云服务器', host: '', port: 22, user: '', localPort: 8188, remoteHost: '127.0.0.1', remotePort: 8188 }
  const [draft, setDraft] = useState(connection || emptyConnection)
  const [password, setPassword] = useState('')
  const connected = connection?.status?.state === 'connected'
  const passwordAvailable = Boolean(password || connection?.hasPassword)
  useEffect(() => { if (connection) setDraft(connection) }, [connection])
  const update = (key, value) => setDraft(current => ({ ...current, [key]: ['port', 'localPort', 'remotePort'].includes(key) ? Number(value) : value }))
  const start = () => {
    try { onStart({ ...draft, ...(password ? { password } : {}) }) } finally { setPassword('') }
  }
  const save = () => {
    const config = { ...draft, ...(password ? { password } : {}) }
    setPassword('')
    onSave(config)
  }
  const sync = () => {
    const value = { ...draft, ...(password ? { password } : {}) }
    setPassword('')
    onSync(value)
  }
  return <div className="adw-ssh-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section aria-labelledby="adw-ssh-title" aria-modal="true" className="adw-ssh-panel" role="dialog">
      <div className="adw-ssh-heading"><div><h2 id="adw-ssh-title">云服务器连接</h2></div><button aria-label="关闭云服务器设置" onClick={onClose} type="button">×</button></div>
      <div className={`adw-ssh-status is-${connection?.status?.state || 'unconfigured'}`}><i /> <div><strong>{connection?.status?.label || (error ? '无法读取状态' : '正在读取设置…')}</strong>{connection?.status?.state === 'error' && connection.status.detail ? <span>{connection.status.detail}</span> : null}</div></div>
      <div className="adw-ssh-grid">
        <label className="adw-ssh-field is-wide"><span>{connection?.hasPassword ? 'SSH 密码（已保存在本机）' : 'SSH 密码（仅保存在本机）'}</span><input autoComplete="off" onChange={event => setPassword(event.target.value)} placeholder={connection?.hasPassword ? '留空继续使用，输入新密码可替换' : '请输入服务器密码'} type="password" value={password} /></label>
        {[["host", "服务器地址", "example.com"], ["user", "SSH 用户名", "ubuntu"], ["port", "SSH 端口", "22"], ["localPort", "本地转发端口", "8188"], ["remoteHost", "云端服务地址", "127.0.0.1"], ["remotePort", "云端服务端口", "8188"]].map(([key, label, placeholder]) => <label className="adw-ssh-field" key={key}><span>{label}</span><input onChange={event => update(key, event.target.value)} placeholder={placeholder} type={['port', 'localPort', 'remotePort'].includes(key) ? 'number' : 'text'} value={draft[key] ?? ''} /></label>)}
      </div>
      {error ? <p className="adw-ssh-error" role="alert">{error}</p> : null}
      <div className="adw-ssh-actions"><button className="is-primary is-sync" disabled={busy || !draft.host || !draft.user || !passwordAvailable} onClick={sync} type="button">{syncing ? '同步中…' : '同步工作流'}</button><button disabled={busy} onClick={save} type="button">保存设置</button>{connected ? <button className="is-danger" disabled={busy} onClick={onStop} type="button">断开连接</button> : connection?.status?.state === 'error' || connection?.status?.state === 'connecting' ? <button className="is-danger" disabled={busy} onClick={onStop} type="button">重置连接</button> : <button disabled={busy || !draft.host || !draft.user || !passwordAvailable} onClick={start} type="button">启动连接</button>}</div>
    </section>
  </div>
}

function DramaWorkbenchShell() {
  const [active, setActive] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [chatNotice, setChatNotice] = useState('')
  const [ssh, setSsh] = useState(null)
  const [sshOpen, setSshOpen] = useState(false)
  const [sshBusy, setSshBusy] = useState(false)
  const [sshActivity, setSshActivity] = useState('')
  const [sshError, setSshError] = useState('')
  const launchRef = useRef(null)
  const overlayRef = useRef(null)
  const controlsRef = useRef(null)
  const returnFocusRef = useRef(null)
  const shouldRestoreFocusRef = useRef(false)
  const chatReturnFocusRef = useRef(null)

  const rememberFocusBeforeOpening = useCallback(() => {
    const focused = document.activeElement
    returnFocusRef.current = focused instanceof HTMLElement && focused !== document.body ? focused : null
    shouldRestoreFocusRef.current = true
  }, [])

  const openWorkbench = useCallback(() => {
    rememberFocusBeforeOpening()
    setChatNotice('')
    setChatOpen(false)
    setActive(true)
  }, [rememberFocusBeforeOpening])

  useEffect(() => {
    window.addEventListener('ai-drama:open-workbench', openWorkbench)
    return () => window.removeEventListener('ai-drama:open-workbench', openWorkbench)
  }, [openWorkbench])

  const loadSsh = useCallback(async () => {
    try {
      const response = await fetch('/ai-drama/api/ssh', { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '无法读取 SSH 状态')
      setSsh(data); setSshError('')
    } catch (error) { setSshError(error instanceof Error ? error.message : '无法读取 SSH 状态') }
  }, [])

  useEffect(() => {
    if (!active) return undefined
    void loadSsh()
    const timer = window.setInterval(() => void loadSsh(), 10000)
    return () => window.clearInterval(timer)
  }, [active, loadSsh])

  const sshAction = useCallback(async (endpoint, body = {}) => {
    setSshBusy(true)
    setSshActivity(endpoint)
    try {
      const response = await fetch(`/ai-drama/api/ssh/${endpoint}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'SSH 操作失败')
      setSsh(data); setSshError('')
      return data
    } catch (error) {
      const message = error instanceof Error ? error.message : 'SSH 操作失败'
      await loadSsh()
      setSshError(message)
      return null
    } finally { setSshBusy(false); setSshActivity('') }
  }, [loadSsh])

  useEffect(() => {
    setWorkbenchMode(active, chatOpen)
    return () => setWorkbenchMode(false)
  }, [active, chatOpen])

  useLayoutEffect(() => {
    if (!active) return undefined
    overlayRef.current?.focus({ preventScroll: true })
    const frame = window.requestAnimationFrame(() => {
      const firstControl = collectFocusableElements([overlayRef.current, controlsRef.current])[0]
      if (firstControl) firstControl.focus({ preventScroll: true })
      else overlayRef.current?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [active])

  useEffect(() => {
    if (!active) return undefined
    const conversation = chatOpen ? document.querySelector('[data-slot="conversation"] > *') : null
    return isolateHarnessBackground([overlayRef.current, controlsRef.current, conversation])
  }, [active, chatOpen])

  useEffect(() => {
    if (active || !shouldRestoreFocusRef.current) return undefined
    const timer = window.setTimeout(() => {
      const originalTarget = returnFocusRef.current
      const target = originalTarget?.isConnected && isVisibleFocusable(originalTarget)
        ? originalTarget
        : launchRef.current
      target?.focus({ preventScroll: true })
      shouldRestoreFocusRef.current = false
      returnFocusRef.current = null
    }, 0)
    return () => window.clearTimeout(timer)
  }, [active])

  useEffect(() => {
    if (!active) return undefined
    const conversation = document.querySelector('[data-slot="conversation"] > *')
    if (!conversation) return undefined
    const previousId = conversation.getAttribute('id')
    conversation.id = 'adw-ai-conversation'
    return () => {
      if (previousId) conversation.id = previousId
      else conversation.removeAttribute('id')
    }
  }, [active])

  useEffect(() => {
    if (!active || !chatOpen) return undefined
    const timer = window.setTimeout(() => {
      const chatInput = document.querySelector('[data-slot="conversation"] textarea, [data-slot="conversation"] [contenteditable="true"]')
      const focusTarget = chatInput ?? document.querySelector('.adw-chat-close')
      focusTarget?.focus()
    }, 120)
    return () => window.clearTimeout(timer)
  }, [active, chatOpen])

  const closeChat = useCallback(() => {
    setChatOpen(false)
    const previousTarget = chatReturnFocusRef.current
    window.setTimeout(() => {
      const target = previousTarget?.isConnected && isVisibleFocusable(previousTarget)
        ? previousTarget
        : controlsRef.current?.querySelector('.adw-top-tool-button')
      target?.focus({ preventScroll: true })
      chatReturnFocusRef.current = null
    }, 0)
  }, [])

  useEffect(() => {
    if (!active || !chatOpen) return undefined
    const closeOnEscape = event => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeChat()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [active, chatOpen, closeChat])

  useEffect(() => {
    if (!active) return undefined
    const trapFocus = event => {
      if (event.key !== 'Tab') return
      const conversation = chatOpen ? document.querySelector('[data-slot="conversation"] > *') : null
      const roots = chatOpen
        ? [conversation, controlsRef.current]
        : [overlayRef.current, controlsRef.current]
      const focusable = collectFocusableElements(roots)
      if (!focusable.length) {
        event.preventDefault()
        overlayRef.current?.focus({ preventScroll: true })
        return
      }

      let focused = document.activeElement
      while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement
      const currentIndex = focusable.indexOf(focused)
      const boundaryIndex = event.shiftKey ? 0 : focusable.length - 1
      if (currentIndex !== boundaryIndex && currentIndex !== -1) return
      event.preventDefault()
      focusable[event.shiftKey ? focusable.length - 1 : 0].focus({ preventScroll: true })
    }
    window.addEventListener('keydown', trapFocus)
    return () => window.removeEventListener('keydown', trapFocus)
  }, [active, chatOpen])

  const toggleChat = () => {
    if (!document.querySelector('[data-slot="conversation"] > *')) {
      setChatOpen(false)
      setChatNotice('未打开 AI 对话。')
      return
    }
    if (chatOpen) {
      closeChat()
      return
    }
    const focused = document.activeElement
    chatReturnFocusRef.current = focused instanceof HTMLElement ? focused : null
    setChatNotice('')
    setChatOpen(true)
  }

  const exitWorkbench = () => {
    if (!returnFocusRef.current) {
      const focused = document.activeElement
      returnFocusRef.current = focused instanceof HTMLElement && focused !== document.body ? focused : null
    }
    shouldRestoreFocusRef.current = true
    setChatOpen(false)
    setChatNotice('')
    setActive(false)
  }

  if (!active) {
    return <button className="adw-standard-launch" onClick={openWorkbench} ref={launchRef} type="button">进入 AI 漫剧工作台</button>
  }
  return <>
    <section aria-label="AI 漫剧工作台" aria-modal="true" className="adw-workbench-overlay" ref={overlayRef} role="dialog" tabIndex={-1}><ShadowWorkbench /></section>
    {createPortal(<div className="adw-workbench-controls" ref={controlsRef}>
    <nav aria-label="工作台快捷入口" className="adw-top-tools">
      <button className="adw-top-tool-button" onClick={toggleChat} type="button"><span aria-hidden="true">AI</span>问 AI</button>
      <button className={`adw-top-tool-button adw-ssh-tool is-${ssh?.status?.state || 'unknown'}`} onClick={() => { setSshOpen(true); void loadSsh() }} type="button"><span aria-hidden="true">⌁</span>云服务器{ssh?.status?.label ? <small>{ssh.status.label}</small> : null}</button>
    </nav>
    {chatNotice ? <div className="adw-chat-hint" role="status">{chatNotice}</div> : null}
    {sshOpen ? <SshSettings connection={ssh} error={sshError} busy={sshBusy} syncing={sshBusy && sshActivity === 'sync'} onClose={() => setSshOpen(false)} onSave={value => void sshAction('config', value)} onStart={value => void sshAction('start', value)} onStop={() => void sshAction('stop')} onSync={value => void sshAction('sync', value)} /> : null}
    {chatOpen ? <button aria-label="关闭 AI 对话" className="adw-chat-close" onClick={closeChat} type="button"><span aria-hidden="true" className="adw-chat-close-mark">×</span>关闭对话</button> : null}
    <button aria-label="退出 AI 漫剧工作台" className="adw-exit-fab" onClick={exitWorkbench} type="button"><span aria-hidden="true" className="adw-exit-fab-mark">←</span>退出工作台</button>
    </div>, document.body)}
  </>
}

export const inject = ['slots']

export function apply(ctx) {
  const disposeStyles = installStyles()
  ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'ai-drama-workbench', order: 100,
  }, DramaWorkbenchShell)), 'ai-drama-workbench: overlay')
  ctx.effect(() => () => disposeStyles(), 'ai-drama-workbench: styles')
}
