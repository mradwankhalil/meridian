async (page) => {
  const receipts = [];
  const base = 'http://127.0.0.1:42542';
  const read = () => page.evaluate(() => ({
    url: location.href,
    visible: [...document.querySelectorAll('.profile-card[data-id]')]
      .filter(e => !e.hidden && getComputedStyle(e).display !== 'none')
      .map(e => e.dataset.id),
    saved: localStorage.getItem('meridian.hiddenProviders'),
  }));
  const check = async (name, expected) => {
    await page.waitForFunction(want => {
      const actual = [...document.querySelectorAll('.profile-card[data-id]')]
        .filter(e => !e.hidden && getComputedStyle(e).display !== 'none')
        .map(e => e.dataset.id);
      return JSON.stringify(actual) === JSON.stringify(want);
    }, expected);
    const value = await read();
    if (value.saved !== '["claude"]') throw new Error(name + ': changed saved preference');
    receipts.push({ case: name, ...value });
  };
  await page.goto(base + '/');
  await page.evaluate(() => localStorage.setItem('meridian.hiddenProviders', '["claude"]'));
  for (const path of ['/', '/profiles']) {
    const prefix = path === '/' ? 'landing' : 'profiles';
    await page.goto(base + path + '?provider=chatgpt');
    await page.locator('.profile-card[data-id]').first().waitFor({state:'attached'});
    await check(prefix + '-url', ['g1']);
    await page.getByRole('button', {name:'ChatGPT 1', exact:true}).click();
    await page.waitForURL(base + path + '?provider=');
    await check(prefix + '-last-off', []);
    await page.reload();
    await page.locator('.profile-card[data-id]').first().waitFor({state:'attached'});
    await check(prefix + '-empty-reload', []);
    await page.screenshot({path:'output/playwright/' + prefix + '-empty.png'});
    await page.getByRole('button', {name:'Show all', exact:true}).click();
    await page.waitForURL(base + path + '?provider=claude,chatgpt');
    await check(prefix + '-show-all', ['c1','g1']);
    await page.screenshot({path:'output/playwright/' + prefix + '-show-all.png'});
    await page.goto(base + path + '?provider=claude');
    await check(prefix + '-claude', ['c1']);
    await page.evaluate(() => history.pushState({}, '', '?provider=chatgpt'));
    await page.goBack();
    await check(prefix + '-history-back', ['c1']);
    await page.goForward();
    await check(prefix + '-history-forward', ['g1']);
    await page.goto(base + path + '?provider=unknown');
    await page.locator('.profile-card[data-id]').first().waitFor({state:'attached'});
    await check(prefix + '-unknown-fallback', ['g1']);
    await page.goto(base + path);
    await page.locator('.profile-card[data-id]').first().waitFor({state:'attached'});
    await check(prefix + '-plain-fallback', ['g1']);
  }
  await page.goto(base + '/profiles?provider=chatgpt#c1');
  await check('profiles-hidden-anchor-reveal', ['c1','g1']);
  if (!(await page.url()).endsWith('?provider=claude,chatgpt#c1')) throw new Error('anchor URL not preserved');
  return {
    sourceHead:'e9282856ecab90c564010fb963a98a102061b3c9',
    environment:await page.evaluate(() => ({userAgent:navigator.userAgent,platform:navigator.platform,viewport:{width:innerWidth,height:innerHeight}})),
    fixture:'docs/maintenance/evidence/backlog-20261018/provider-filter-fixture.ts',
    scope:'Production page modules, synthetic profiles, isolated browser. No credentials or model calls.',
    receipts,
  };
}
