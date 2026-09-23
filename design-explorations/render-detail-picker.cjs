const { chromium } = require('playwright');
const { readFileSync } = require('fs');
const path = require('path');

(async () => {
  const css = ['src/styles/design-tokens.css', 'src/index.css', 'src/components/scheduling/SchedulingSheets.css']
    .map((file) => readFileSync(path.join(__dirname, '..', file), 'utf8')).join('\n');
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  try {
    const page = await browser.newPage({ viewport: { width: 720, height: 460 } });
    await page.setContent(`<style>${css}</style><main style="padding:40px 70px"><div style="width:290px;border:1px solid #d4dbe5;padding:10px;background:#fdfcf9"><span class="ss-person-roster ss-roster-user ss-roster-active"><span class="ss-roster-name-row"><span class="ss-roster-name">Sarah Levine</span><button class="ss-chip-edit-details">Edit</button></span><span class="ss-roster-details">Usher · North door</span></span><div class="ss-group-target">Adding details to <strong>Sarah Levine</strong><button>Done</button></div><input class="ss-inline-cell-input" value="@North" /></div><div class="ss-picker ss-cell-suggestions" style="position:absolute;left:70px;top:177px;width:290px;z-index:60" role="listbox"><button class="ss-picker-row ss-picker-active" role="option">Add North door to Sarah Levine</button><div class="ss-picker-group">People</div><button class="ss-picker-row" role="option">Sarah Levine</button><div class="ss-picker-group">Locations</div><button class="ss-picker-row" role="option">North Hall</button></div></main>`);
    await page.evaluate(() => {
      const list = document.querySelector('.ss-cell-suggestions');
      const input = document.querySelector('.ss-inline-cell-input');
      list.style.top = `${window.scrollY + input.getBoundingClientRect().bottom + 4}px`;
      const people = [...list.querySelectorAll('.ss-picker-group')].find((group) => group.textContent === 'People');
      people.nextElementSibling.remove();
      people.remove();
    });
    await page.screenshot({ path: path.join(__dirname, 'scheduling-detail-picker-preview.png') });
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
