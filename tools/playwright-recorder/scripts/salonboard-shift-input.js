const { chromium } = require('@playwright/test');
const path = require('path');

const profileDir = path.join(__dirname, '..', '.pw-profile-shared');

function parseArgs(argv) {
  const options = {
    url: process.env.SALONBOARD_SHIFT_URL || '',
    staff: process.env.SALONBOARD_STAFF || '',
    date: process.env.SALONBOARD_SHIFT_DATE || '',
    schedules: [],
    finalSave: process.env.SALONBOARD_FINAL_SAVE === '1',
    headless: process.env.HEADLESS === '1',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (!argv[i]) throw new Error(`${arg} requires a value`);
      return argv[i];
    };

    if (arg === '--url') options.url = next();
    else if (arg === '--staff') options.staff = next();
    else if (arg === '--date') options.date = next();
    else if (arg === '--schedule') options.schedules.push(parseSchedule(next()));
    else if (arg === '--final-save') options.finalSave = true;
    else if (arg === '--headless') options.headless = true;
    else if (arg === '--help') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!options.url) throw new Error('--url or SALONBOARD_SHIFT_URL is required');
  if (!options.staff) throw new Error('--staff or SALONBOARD_STAFF is required');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.date)) {
    throw new Error('--date must be YYYY-MM-DD');
  }
  if (options.schedules.length === 0) {
    throw new Error('At least one --schedule HH:MM-HH:MM is required');
  }

  return options;
}

function parseSchedule(value) {
  const match = value.match(/^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/);
  if (!match) throw new Error(`Invalid schedule: ${value}`);

  return {
    startHour: match[1],
    startMinute: match[2],
    endHour: match[3],
    endMinute: match[4],
  };
}

function printHelp() {
  console.log(`Usage:
  pnpm salonboard:shift -- \\
    --url "https://salonboard.com/KLP/set/shiftSetup/?date=202607" \\
    --staff "岩橋" \\
    --date 2026-07-01 \\
    --schedule 10:00-12:00 \\
    --schedule 18:00-23:00

Options:
  --final-save  Click the staff row's final 設定 button after modal input.
  --headless    Run Chrome headless.
`);
}

function dayOfMonth(date) {
  return Number(date.slice(8, 10));
}

function japaneseDatePrefix(date) {
  const [year, month, day] = date.split('-');
  return `${year}年${month}月${day}日`;
}

function shiftCellIndex(day) {
  if (day < 1 || day > 31) throw new Error(`Invalid day: ${day}`);
  return day <= 15 ? day + 1 : day + 2;
}

async function removeExistingSchedules(page) {
  const deleteLinks = page.getByRole('link', { name: '削除' });
  while (await deleteLinks.count() > 0) {
    await deleteLinks.first().click();
  }
}

async function fillSchedule(page, index, schedule) {
  await page.getByRole('link', { name: '新規追加する' }).click();
  await page.locator('select[name="schStartHours"]').nth(index).selectOption(schedule.startHour);
  await page.locator('select[name="schStartMinutes"]').nth(index).selectOption(schedule.startMinute);
  await page.locator('select[name="schEndHours"]').nth(index).selectOption(schedule.endHour);
  await page.locator('select[name="schEndMinutes"]').nth(index).selectOption(schedule.endMinute);
}

async function inputShift(page, options) {
  await page.goto(options.url, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'シフト設定' }).waitFor();

  const row = page.getByRole('row', { name: new RegExp(`^${escapeRegex(options.staff)}\\s`) }).first();
  await row.waitFor();

  const cellIndex = shiftCellIndex(dayOfMonth(options.date));
  await row.locator('td').nth(cellIndex).getByRole('link').click();

  await page.getByRole('heading', {
    name: new RegExp(`${japaneseDatePrefix(options.date)}.*${escapeRegex(options.staff)}`),
  }).waitFor().catch(async () => {
    await page.getByRole('heading', { name: new RegExp(escapeRegex(options.staff)) }).waitFor();
  });

  await page.getByRole('radio', { name: '出勤' }).check();
  await removeExistingSchedules(page);

  for (let i = 0; i < options.schedules.length; i += 1) {
    await fillSchedule(page, i, options.schedules[i]);
  }

  await page.getByRole('link', { name: /^(入力する|確定)$/ }).click();
  await page.getByRole('heading', { name: new RegExp(escapeRegex(options.staff)) }).waitFor({ state: 'detached' }).catch(() => {});

  const updatedRow = page.getByRole('row', { name: new RegExp(`^${escapeRegex(options.staff)}\\s`) }).first();
  await updatedRow.locator('td').nth(cellIndex).getByRole('link', { name: '出' }).waitFor();

  if (options.finalSave) {
    await updatedRow.locator('td').nth(1).getByRole('link', { name: '設定' }).click();
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: 'chrome',
    headless: options.headless,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = context.pages()[0] || await context.newPage();
    await inputShift(page, options);
    console.log(JSON.stringify({
      ok: true,
      staff: options.staff,
      date: options.date,
      schedules: options.schedules,
      finalSave: options.finalSave,
    }, null, 2));
  } finally {
    await context.close();
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
