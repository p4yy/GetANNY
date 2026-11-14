import React, { useEffect, useRef, useState } from "react";
import { LuALargeSmall, LuCheck, LuChevronDown } from "react-icons/lu";
import useSettingsStore from "../stores/useSettingsStore";
import useUIStore from "../stores/useUIStore";
import { errorMessage } from "../api";
import { useI18n } from "../i18n/useI18n";
const modes=["minimal","dense","compact","classic","comfortable"];
export default function InterfaceSizeSwitcher(){
 const {t}=useI18n();const size=useSettingsStore(s=>s.settings.interfaceSize||"classic");
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false);const root=useRef(null),trigger=useRef(null);
 useEffect(()=>{if(!open)return;const outside=e=>{if(!root.current?.contains(e.target))setOpen(false);};const key=e=>{if(e.key==='Escape'){setOpen(false);trigger.current?.focus();}};document.addEventListener('pointerdown',outside);document.addEventListener('keydown',key);return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',key);};},[open]);
 const choose=async(mode)=>{setBusy(true);try{await useSettingsStore.getState().save('interfaceSize',mode);setOpen(false);trigger.current?.focus();}catch(e){useUIStore.getState().notify(errorMessage(e),'error');}finally{setBusy(false);}};
 return <div className="theme-switcher interface-size-switcher" ref={root}>
  <button ref={trigger} type="button" className="theme-quick-button" aria-label={`${t('interface.title')}: ${t(`interface.${size}`)}`} title={t('interface.title')} aria-haspopup="menu" aria-expanded={open} onClick={()=>setOpen(value=>!value)}><LuALargeSmall aria-hidden="true"/><span className="theme-quick-name">{t(`interface.${size}`)}</span><LuChevronDown className="theme-chevron" aria-hidden="true"/></button>
  {open&&<div className="theme-quick-menu interface-size-menu" role="menu" aria-label={t('interface.title')} onKeyDown={e=>{const buttons=[...e.currentTarget.querySelectorAll('[role="menuitemradio"]')];const index=buttons.indexOf(document.activeElement);if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?buttons.length-1:(index+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons[next]?.focus();}}}>
   <div className="theme-menu-heading"><span>{t('interface.title')}</span></div><div className="theme-menu-list">{modes.map(mode=><button type="button" key={mode} role="menuitemradio" aria-checked={size===mode} disabled={busy} onClick={()=>choose(mode)}><span>{t(`interface.${mode}`)}</span>{size===mode&&<LuCheck aria-hidden="true"/>}</button>)}</div>
  </div>}
 </div>;
}
