(() => { const OFF = 8 * 3600e3; const RD = Date;
  class D extends RD { constructor(...a) { if (a.length === 0) super(RD.now() + OFF); else super(...a); } static now() { return RD.now() + OFF; } }
  window.Date = D; })();
