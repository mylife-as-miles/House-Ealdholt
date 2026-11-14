import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { translate, type Locale } from '../../shared/menu/localization';
import './MenuLocale.css';

interface MenuLocaleValue { locale: Locale; setLocale(locale: Locale): void; t(text: string): string }
const MenuLocaleContext = createContext<MenuLocaleValue>({ locale: 'en', setLocale() {}, t: text => text });

export function MenuLocaleProvider({ locale, onChange, children }: { locale: Locale; onChange(locale: Locale): void; children: ReactNode }) {
  const t = useCallback((text: string) => translate(text, locale), [locale]);
  const value = useMemo(() => ({ locale, setLocale: onChange, t }), [locale, onChange, t]);
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  return <MenuLocaleContext.Provider value={value}>{children}</MenuLocaleContext.Provider>;
}

export function useMenuLocale(): MenuLocaleValue { return useContext(MenuLocaleContext); }
