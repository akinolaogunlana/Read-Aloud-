/*
 * Read Aloud -- centralized ad configuration and injection.
 * Copyright (c) 2026 Ogunlana Akinola Okikiola. All rights reserved.
 *
 * THIS IS THE ONLY FILE YOU EVER NEED TO EDIT TO CHANGE ADS SITEWIDE.
 *
 * Every page loads this one script. It finds every element with class
 * "ad-slot" already sitting in that page's HTML (the placeholder boxes
 * already built into index.html and all 14 landing pages) and activates
 * them with a real ad unit -- using the settings below.
 *
 * To go from "placeholder boxes" to "live ads" everywhere at once:
 * fill in your AdSense client ID below and re-upload just this one file.
 * No other file on the site needs to change.
 *
 * To turn ads off sitewide instantly (e.g. a policy issue, or you
 * decide against ads): set ENABLED to false below. One line, one file.
 */

const AD_CONFIG = {
  // Your AdSense publisher ID, e.g. 'ca-pub-1234567890123456'.
  // Leave this blank and every .ad-slot on every page keeps showing
  // its placeholder box, exactly as it looks right now -- nothing
  // breaks, nothing looks unfinished, while you wait on approval.
  adsenseClientId: '',

  // Master on/off switch for the whole site.
  enabled: true,

  // Optional: give a specific ad-slot ID (from your AdSense dashboard)
  // to specific placements by position, if you ever want different
  // units in different spots instead of one generic auto unit
  // everywhere. Leave empty to just use auto-format everywhere, which
  // is the simplest option and fine to start with.
  slotIdsByPosition: []
};

(function(){
  if(!AD_CONFIG.enabled) return;
  if(!AD_CONFIG.adsenseClientId) return; // not configured yet -- leave placeholders as-is

  function loadAdsenseLibrary(){
    if(document.querySelector('script[data-adsense-lib]')) return; // already loaded
    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + AD_CONFIG.adsenseClientId;
    script.crossOrigin = 'anonymous';
    script.setAttribute('data-adsense-lib', 'true');
    document.head.appendChild(script);
  }

  function activateSlots(){
    const slots = document.querySelectorAll('.ad-slot');
    slots.forEach((slot, i) => {
      const placeholder = slot.querySelector('.ad-placeholder');
      if(!placeholder) return; // already activated or not a real slot

      const ins = document.createElement('ins');
      ins.className = 'adsbygoogle';
      ins.style.display = 'block';
      ins.setAttribute('data-ad-client', AD_CONFIG.adsenseClientId);
      const specificSlotId = AD_CONFIG.slotIdsByPosition[i];
      if(specificSlotId){
        ins.setAttribute('data-ad-slot', specificSlotId);
      } else {
        ins.setAttribute('data-ad-format', 'auto');
        ins.setAttribute('data-full-width-responsive', 'true');
      }

      placeholder.replaceWith(ins);

      try{
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      }catch(e){
        console.error('AdSense initialization failed for slot ' + i, e);
      }
    });
  }

  function init(){
    loadAdsenseLibrary();
    activateSlots();
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
