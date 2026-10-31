import { translate, type TuiLocale } from "../i18n"

// The mini frontend runs one session loop per process, so it owns one active locale.
let locale: TuiLocale = "ja"

export function setMiniLocale(value: string | undefined) {
  locale = value === "en" ? "en" : "ja"
}

export function miniLocale() {
  return locale
}

export function t(source: string, params?: Record<string, string | number | boolean>) {
  return translate(locale, source, params)
}
