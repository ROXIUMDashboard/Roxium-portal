/**
 * The manual acceptance workflow, automated.
 *
 * Two browsers open the same collaboration link as two different surgeons and
 * work the programme: drag, edit, extend a session, resolve the conflict that
 * creates, sponsor a break, move a session to another day, then check the
 * change history and restore.
 */
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { E2E_TOKEN } from '../playwright.config';

// The collaboration link opens on Faculty; these tests work the agenda, so name it.
const LINK = `/program/${E2E_TOKEN}#agenda`;

async function enter(context: BrowserContext, name: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(LINK);
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Enter Program' }).click();
  await expect(page.getByRole('heading', { name: 'Endoscopic Facial Rejuvenation' })).toBeVisible();
  return page;
}

function row(page: Page, title: string) {
  return page.getByRole('button', { name: new RegExp(`^Edit ${title}$`, 'i') });
}

/** Bring a row fully clear of the sticky masthead before grabbing it. */
async function centre(page: Page, title: string) {
  await row(page, title).evaluate((node) => node.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(150);
}

/** dnd-kit needs a real pointer gesture: press, travel past the threshold, drop. */
async function dragTo(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= 12; step += 1) {
    await page.mouse.move(
      from.x + ((to.x - from.x) * step) / 12,
      from.y + ((to.y - from.y) * step) / 12,
      { steps: 2 },
    );
    if (step === 4) {
      // The day selector turns into a drop target only while a drag is live.
      await expect(page.getByText('Drop on a day to move this session there')).toBeVisible();
    }
  }
  await page.mouse.up();
}

test.describe('BHFA 2027 planning room', () => {
  test('two surgeons plan the program together', async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    // 1–2 · Both open the same link, under their own names.
    const max = await enter(contextA, 'Max');
    const ashkan = await enter(contextB, 'Ashkan');

    await expect(max.getByRole('heading', { name: '2027 Scientific Program' })).toBeVisible();
    await expect(max.getByText('Working Program', { exact: true }).first()).toBeVisible();

    // 3–4 · Max drags a session upward; Ashkan sees it without refreshing.
    await centre(max, 'Grand Rounds');
    const debate = row(max, 'Debate');
    const target = await debate.boundingBox();
    expect(target).toBeTruthy();
    const handle = max.getByRole('button', { name: /Reorder Grand Rounds/i });
    const handleBox = await handle.boundingBox();
    await dragTo(
      max,
      { x: handleBox!.x + handleBox!.width / 2, y: handleBox!.y + handleBox!.height / 2 },
      { x: target!.x + 60, y: target!.y + 10 },
    );

    const orderOnA = max.locator('article h3');
    await expect(orderOnA.filter({ hasText: 'Grand Rounds' })).toBeVisible();
    await expect
      .poll(async () => {
        const titles = await ashkan.locator('article h3').allInnerTexts();
        return titles.indexOf('Grand Rounds') < titles.indexOf('Debate');
      }, { message: 'Ashkan should see the new order without refreshing' })
      .toBe(true);

    // 5–6 · Ashkan changes a speaker; Max sees it live.
    await row(ashkan, 'Complication Forum').click();
    await ashkan.getByRole('button', { name: '+ Add speaker' }).click();
    await ashkan.getByLabel('Speaker 1 name').fill('Dr. Ashkan Ghavami');
    await ashkan.keyboard.press('Escape');
    await expect(ashkan.getByText('Dr. Ashkan Ghavami').first()).toBeVisible();
    await expect(max.getByText('Dr. Ashkan Ghavami').first()).toBeVisible({ timeout: 15_000 });

    // 7–9 · Max extends a session and chooses to change only this session.
    await row(max, 'Anatomy Session').click();
    await expect(max.getByLabel('Start', { exact: true })).toHaveValue('13:30');
    await max.getByLabel('End', { exact: true }).fill('14:30');

    await expect(max.getByText('This session is now 15 min longer.')).toBeVisible();
    await max.getByRole('button', { name: /Change this session only/i }).click();
    await max.keyboard.press('Escape');

    // 10 · The next session is now in conflict, in red.
    const conflicted = row(max, 'Technique \\+ Cases');
    await expect(conflicted.getByText('15 MIN OVERLAP')).toBeVisible();
    await expect
      .poll(async () => ashkan.getByText('15 MIN OVERLAP').count())
      .toBeGreaterThan(0);

    // 11–12 · Fix it by shifting this session and everything after it.
    await max.getByRole('button', { name: 'Fix' }).first().click();
    await max.getByRole('menuitem', { name: /Shift this session and all following/i }).click();

    await expect(max.getByText('15 MIN OVERLAP')).toHaveCount(0);
    await expect(conflicted.getByText('2:30 PM – 3:30 PM')).toBeVisible();
    // Everything after it moved by the same 15 minutes.
    await expect(row(max, 'Coffee Break').last().getByText('3:30 PM – 3:45 PM')).toBeVisible();
    await expect(row(max, 'Takeaways').getByText('6:45 PM – 7:15 PM')).toBeVisible();

    // 13–14 · A sponsor on Lunch, presented quietly.
    await row(max, 'Lunch').click();
    await max.getByRole('button', { name: 'More options' }).click();
    await max.getByLabel('Sponsor / partner').fill('AbbVie');
    await max.keyboard.press('Escape');
    await expect(max.getByText('Supported by AbbVie')).toBeVisible();
    await expect(ashkan.getByText('Supported by AbbVie')).toBeVisible({ timeout: 15_000 });

    // 15–16 · Removing it leaves nothing behind.
    await row(max, 'Lunch').click();
    await max.getByRole('button', { name: 'More options' }).click();
    await max.getByLabel('Sponsor / partner').fill('');
    await max.keyboard.press('Escape');
    await expect(max.getByText('Supported by', { exact: false })).toHaveCount(0);
    await expect(max.getByText(/sponsor/i)).toHaveCount(0);

    // 17 · Move a session to Friday by dropping it on the day selector.
    await centre(max, 'Surgical Debrief');
    const debriefHandle = max.getByRole('button', { name: /Reorder Surgical Debrief/i });
    const debriefBox = await debriefHandle.boundingBox();
    const fridayTab = max.getByRole('button', { name: /02\s*FRI\s*Deep Plane/i });
    const fridayBox = await fridayTab.boundingBox();
    await dragTo(
      max,
      { x: debriefBox!.x + debriefBox!.width / 2, y: debriefBox!.y + debriefBox!.height / 2 },
      { x: fridayBox!.x + fridayBox!.width / 2, y: fridayBox!.y + fridayBox!.height / 2 },
    );

    await expect(max.getByText(/moved to Day 02/i)).toBeVisible();
    await expect(row(max, 'Surgical Debrief')).toHaveCount(0);

    // 18 · It is still there after a refresh, on Friday.
    await max.reload();
    await expect(max.getByRole('heading', { name: 'Endoscopic Facial Rejuvenation' })).toBeVisible();
    await expect(row(max, 'Surgical Debrief')).toHaveCount(0);
    await max.getByRole('button', { name: /02\s*FRI\s*Deep Plane/i }).click();
    await expect(row(max, 'Surgical Debrief')).toHaveCount(2); // its own plus Day 02's original

    // 19–20 · The change history names both surgeons.
    await max.getByRole('button', { name: 'Program options' }).click();
    await max.getByRole('menuitem', { name: 'Change history' }).click();
    const historyPanel = max.getByLabel('Change history');
    await expect(historyPanel).toBeVisible();
    await expect(historyPanel.getByText('Max').first()).toBeVisible();
    await expect(historyPanel.getByText('Ashkan').first()).toBeVisible();
    await expect(historyPanel.getByText(/Moved .* to Day 02/i).first()).toBeVisible();

    // 21 · Restore the state before that move.
    await historyPanel
      .locator('li', { hasText: /Moved .* to Day 02/i })
      .first()
      .getByRole('button', { name: /Restore previous state/i })
      .click();
    await expect(historyPanel.getByText(/Restored the state before/i).first()).toBeVisible();
    await max.getByRole('button', { name: 'Close' }).click();

    // 22–23 · Both browsers agree after a refresh.
    await max.reload();
    await ashkan.reload();
    await expect(max.getByRole('heading', { name: 'Endoscopic Facial Rejuvenation' })).toBeVisible();
    await expect(ashkan.getByRole('heading', { name: 'Endoscopic Facial Rejuvenation' })).toBeVisible();

    await expect(row(max, 'Surgical Debrief')).toHaveCount(1);
    await expect(row(ashkan, 'Surgical Debrief')).toHaveCount(1);
    await expect(row(max, 'Technique \\+ Cases').getByText('2:30 PM – 3:30 PM')).toBeVisible();
    await expect(row(ashkan, 'Technique \\+ Cases').getByText('2:30 PM – 3:30 PM')).toBeVisible();
    await expect(max.getByText('Supported by', { exact: false })).toHaveCount(0);

    await contextA.close();
    await contextB.close();
  });

  test('midnight reads and edits as midnight', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await enter(context, 'Marc');

    await page.getByRole('button', { name: /03\s*SAT\s*Eyes \+ Anatomy/i }).click();
    const party = row(page, 'Closing Ceremony');
    await expect(party.getByText('8:00 PM – Midnight')).toBeVisible();

    await party.click();
    // 12:00 AM on the following day — never 11:59 PM.
    await expect(page.getByLabel('End', { exact: true })).toHaveValue('00:00');
    await expect(page.getByRole('button', { name: 'Next day' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('ends at midnight')).toBeVisible();
    await expect(page.locator('p[aria-live="polite"]')).toContainText('4 hr');

    // Editing something else must not round midnight down to 23:59.
    await page.getByLabel('Topic').fill('Closing Ceremony · White Party');
    await page.keyboard.press('Escape');
    await page.reload();
    await page.getByRole('button', { name: /03\s*SAT\s*Eyes \+ Anatomy/i }).click();
    await expect(row(page, 'Closing Ceremony · White Party').getByText('8:00 PM – Midnight')).toBeVisible();

    // And the end time can be moved into the following morning explicitly.
    await row(page, 'Closing Ceremony · White Party').click();
    await page.getByLabel('End', { exact: true }).fill('01:00');
    await expect(page.locator('p[aria-live="polite"]')).toContainText('5 hr');
    await page.keyboard.press('Escape');
    await expect(row(page, 'Closing Ceremony · White Party').getByText('8:00 PM – 1:00 AM')).toBeVisible();

    await context.close();
  });

  test('the second writer is told what they replaced', async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    // Max's realtime stream is down, so he never sees Ashkan's change arrive —
    // the case where a save really can land on top of someone else's work.
    // (With the stream up, the editor adopts changes to fields he has not
    // touched and simply shows them instead.)
    await contextA.route('**/api/program/*/stream', (route) => route.abort());

    const max = await enter(contextA, 'Max');
    const ashkan = await enter(contextB, 'Ashkan');

    await max.getByRole('button', { name: /04\s*SUN\s*Practice Growth/i }).click();
    await ashkan.getByRole('button', { name: /04\s*SUN\s*Practice Growth/i }).click();

    // Max opens the session and starts rewriting the topic.
    await row(max, 'Team Systems').click();
    await expect(max.getByLabel('Topic')).toHaveValue('Team Systems');

    // Ashkan saves a change to the same session while Max has it open.
    await row(ashkan, 'Team Systems').click();
    await ashkan.getByLabel('Topic').fill('Team Systems and Accountability');
    await ashkan.keyboard.press('Escape');
    await expect(ashkan.getByText('Team Systems and Accountability')).toBeVisible();

    // Max saves over it. His typing is kept, and he is told exactly what he replaced.
    await max.getByLabel('Topic').fill('Team Operating Systems');
    const notice = max.getByRole('alert', { name: 'Session changed by another collaborator' });
    await expect(notice).toBeVisible({ timeout: 15_000 });
    await expect(notice).toContainText('Ashkan changed this session while you were editing');
    await expect(notice).toContainText('nothing is lost');
    await expect(notice).toContainText('Ashkan: Team Systems and Accountability');
    await expect(notice).toContainText('Yours: Team Operating Systems');

    // He can put Ashkan's version back in one click.
    await notice.getByRole('button', { name: 'Use their version' }).click();
    await expect(max.getByRole('alert', { name: 'Session changed by another collaborator' })).toHaveCount(0);
    await expect(max.getByLabel('Topic')).toHaveValue('Team Systems and Accountability');

    await max.keyboard.press('Escape');
    await max.reload();
    await max.getByRole('button', { name: /04\s*SUN\s*Practice Growth/i }).click();
    await expect(row(max, 'Team Systems and Accountability')).toHaveCount(1);

    // Both versions survive in the history.
    await max.getByRole('button', { name: 'Program options' }).click();
    await max.getByRole('menuitem', { name: 'Change history' }).click();
    const historyPanel = max.getByLabel('Change history');
    await expect(historyPanel.getByText(/Team Operating Systems/).first()).toBeVisible();
    await expect(historyPanel.getByText(/Team Systems and Accountability/).first()).toBeVisible();

    await contextA.close();
    await contextB.close();
  });

  test('an invalid link reveals nothing', async ({ page }) => {
    const response = await page.goto('/program/not_a_real_token_not_a_real_token_xxxx');
    expect(response?.status()).toBe(404);
    await expect(page.getByText(/no longer active/i)).toBeVisible();
    await expect(page.getByText(/Endoscopic|Live Surgery/)).toHaveCount(0);
  });

  test('the agenda is usable on a phone', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const page = await enter(context, 'Marc');

    // Nothing scrolls sideways.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    );
    expect(overflow).toBe(true);

    // Days remain one tap away.
    await page.getByRole('button', { name: /04\s*SUN\s*Practice Growth/i }).click();
    await expect(page.getByText('The Modern Aesthetic Practice')).toBeVisible();

    // Editing controls are touch-sized and do not zoom the page.
    await row(page, 'Market Outlook').click();
    const topic = page.getByLabel('Topic');
    await expect(topic).toBeVisible();
    const metrics = await topic.evaluate((el) => {
      const style = window.getComputedStyle(el);
      return { fontSize: parseFloat(style.fontSize), height: el.getBoundingClientRect().height };
    });
    expect(metrics.fontSize).toBeGreaterThanOrEqual(16);
    expect(metrics.height).toBeGreaterThanOrEqual(44);

    await context.close();
  });
});
