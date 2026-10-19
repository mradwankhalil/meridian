/**
 * Chip choices carried in the page's query string, so a link can open `/` or
 * `/profiles` with a given set of chips on: `/profiles?provider=claude` shows
 * only Claude accounts, whatever the reader last chose.
 *
 * Each chip group reads one parameter holding a comma-separated list of its
 * chip ids. A parameter that is present names exactly the chips that are on;
 * every other chip of that group is off. Ids the group does not know are
 * dropped, and a nonempty parameter with no known id left counts as absent.
 * An explicitly empty parameter turns every chip off; an absent parameter
 * leaves the group on the choice remembered in localStorage.
 *
 * A group the URL names is a view, not a preference: opening the link does
 * not touch the remembered choice, and a click on one of its chips rewrites
 * that parameter with history.replaceState instead of saving, so a reload
 * shows what was on screen and the reader's own choice is still there on the
 * next plain visit. A group the URL does not name saves as it always has.
 *
 * The query leaves location.hash alone, so a profile anchor rides along:
 * `/profiles?provider=claude#work`.
 *
 * `profileFilterUrlJs` is an expression, not a statement: each chip module
 * embeds it in its own closure, so each stays loadable on its own.
 */
export const profileFilterUrlJs = `(function () {
  function loc() { try { return typeof location !== 'undefined' ? location : null; } catch (_) { return null; } }
  function hist() { try { return typeof history !== 'undefined' ? history : null; } catch (_) { return null; } }

  // The known ids the parameter names, in the group's own order; null when
  // the parameter is absent or nonempty with no known ids. Empty means none on.
  function read(param, ids) {
    var l = loc();
    if (!l || typeof l.href !== 'string') return null;
    var raw = null;
    try { raw = new URL(l.href).searchParams.get(param); } catch (_) { raw = null; }
    if (raw == null) return null;
    if (raw === '') return [];
    var named = raw.split(',').map(function (s) { return s.trim(); });
    var on = ids.filter(function (id) { return named.indexOf(id) >= 0; });
    return on.length > 0 ? on : null;
  }

  // Commas stay literal so the address reads as the chips do.
  function write(param, on) {
    var l = loc();
    var h = hist();
    if (!l || !h || typeof h.replaceState !== 'function') return false;
    var url;
    try { url = new URL(l.href); } catch (_) { return false; }
    url.searchParams.set(param, on.join(','));
    url.search = url.searchParams.toString().replace(/%2C/gi, ',');
    if (url.toString() !== l.href) h.replaceState(h.state, '', url.toString());
    return true;
  }

  return { read: read, write: write };
})()`
