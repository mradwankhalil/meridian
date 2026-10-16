/**
 * Finding one profile on /profiles: the `#<profile>` anchor other surfaces
 * link to, and the search box that narrows the list.
 *
 * Emitted as browser source for the same reason `profileFactsJs` is: the pages
 * are string templates, and the unit tests evaluate this exact text, so what
 * they assert is what the browser runs. Both the landing page (which links to
 * a card) and /profiles (which resolves the link and filters) embed it, so the
 * link format and its reader cannot drift apart.
 *
 * The URL carries the bare profile id (`/profiles#enrique-personal`) because
 * that is the name people already know and type. The element it lands on is
 * `profile-<id>` instead: a profile may be called anything the CLI accepts,
 * and a bare `id="content"` would collide with the page's own elements.
 *
 * A rename leaves the old name working for requests (see profiles.ts), so an
 * old link, a status line printed before the rename, or muscle memory naming
 * the former id resolves to the renamed profile rather than to nothing.
 *
 * Search is a case-insensitive substring match; every whitespace-separated
 * term must be found somewhere in the profile's facts, so `max work` narrows
 * to the Max accounts whose name, email or organization mentions work.
 */
export const profileFindJs = `
function profileAnchorElementId(id) { return 'profile-' + String(id); }

function profileHref(id) { return '/profiles#' + encodeURIComponent(String(id)); }

function profileIdFromHash(hash) {
  var raw = String(hash == null ? '' : hash).replace(/^#/, '');
  if (!raw) return '';
  try { return decodeURIComponent(raw); } catch (_) { return raw; }
}

// Exact id, then a former name, then a ChatGPT seat's raw seat id (every
// route accepts one), then the id and former names ignoring case. An id beats
// an alias so a name taken again by a new profile lands on the new owner,
// matching how requests are routed.
function resolveProfileAnchor(hash, profiles) {
  var wanted = profileIdFromHash(hash);
  if (!wanted) return null;
  var list = Array.isArray(profiles) ? profiles : [];
  var lower = wanted.toLowerCase();
  var passes = [
    function (p) { return p.id === wanted; },
    function (p) { return (p.aliases || []).indexOf(wanted) >= 0; },
    function (p) { return !!p.seat && p.seat === wanted; },
    function (p) { return String(p.id).toLowerCase() === lower; },
    function (p) {
      return (p.aliases || []).some(function (a) { return String(a).toLowerCase() === lower; });
    },
  ];
  for (var i = 0; i < passes.length; i++) {
    for (var j = 0; j < list.length; j++) {
      if (list[j] && passes[i](list[j])) return list[j].id;
    }
  }
  return null;
}

// Everything Meridian knows about an account that a person might remember it
// by. Tiers and allowances are included so "5x", "20x" or "max" narrows to a
// plan, and former names so a search for the old name still finds it. The
// default type "claude-max" is left out: every subscription profile carries it
// whatever its plan, so "max" would match a Team account too.
function profileSearchFields(p) {
  if (!p) return [];
  var fields = [
    p.id, p.label, p.type === 'claude-max' ? null : p.type, p.email, p.organizationName, p.accountType,
    p.planName, p.planLabel, p.subscriptionType, p.allowance,
    p.rateLimitTier, p.seatTier,
  ].concat(Array.isArray(p.aliases) ? p.aliases : []);
  return fields
    .filter(function (f) { return f != null && f !== ''; })
    .map(function (f) { return String(f).toLowerCase(); });
}

function profileQueryTerms(query) {
  return String(query == null ? '' : query).toLowerCase().split(/\\s+/)
    .filter(function (t) { return t.length > 0; });
}

function profileMatchesQuery(p, query) {
  var terms = profileQueryTerms(query);
  if (terms.length === 0) return true;
  var fields = profileSearchFields(p);
  return terms.every(function (term) {
    return fields.some(function (f) { return f.indexOf(term) >= 0; });
  });
}
`
