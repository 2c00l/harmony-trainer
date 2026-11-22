try { var s = JSON.parse(localStorage.getItem('ht.settings.v1') || '{}'); var t = s.theme || 'dark';
      if (t === 'system') t = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
      document.documentElement.dataset.theme = t; if (s.palette === 'cb') document.documentElement.dataset.palette = 'cb'; } catch (e) {}
