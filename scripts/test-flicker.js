// Playwright自动化测试:复现手牌闪烁和超时问题
const { chromium } = require('playwright');

(async () => {
  console.log('启动浏览器...');
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  // 注入监控
  await page.addInitScript(() => {
    window._renderLog = [];
    window._lastHandHTML = null;
    
    setInterval(() => {
      const hand = document.querySelector('.ddz-hand');
      if (!hand) return;
      
      const html = hand.innerHTML;
      if (html !== window._lastHandHTML) {
        const myTurn = !!document.querySelector('.ddz-turnbanner.mine');
        const cards = document.querySelectorAll('.ddz-hand .card').length;
        window._renderLog.push({
          time: Date.now(),
          myTurn,
          cards,
          htmlLen: html.length
        });
        window._lastHandHTML = html;
      }
    }, 100);
  });
  
  await page.goto('http://localhost:8901/');
  await page.waitForTimeout(3000);
  
  console.log('匿名登录...');
  await page.click('text=匿名');
  await page.waitForTimeout(2000);
  
  console.log('进入房间...');
  const rooms = await page.locator('.eh-roomline').count();
  if (rooms > 0) {
    await page.locator('.eh-roomline').first().click();
  }
  await page.waitForTimeout(2000);
  
  console.log('开斗地主桌...');
  await page.locator('.eh-chatinput').fill('/ddz');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3000);
  
  console.log('等待游戏开始...');
  await page.waitForSelector('.ddz-room', { timeout: 10000 });
  
  // 玩30秒
  console.log('观察30秒...');
  await page.waitForTimeout(30000);
  
  // 提取日志
  const log = await page.evaluate(() => window._renderLog);
  
  console.log('\n=== 手牌重建日志 ===');
  console.log('总共重建次数:', log.length);
  
  // 分析闪烁
  let flickerCount = 0;
  for (let i = 1; i < log.length; i++) {
    const prev = log[i-1];
    const curr = log[i];
    const interval = curr.time - prev.time;
    
    // 手牌数不变但重建了,且间隔<1秒
    if (prev.cards === curr.cards && interval < 1000) {
      flickerCount++;
      console.log(`[闪烁] t=${(curr.time/1000).toFixed(1)}s 间隔=${interval}ms 我的回合=${curr.myTurn} 手牌=${curr.cards}张`);
    }
  }
  
  console.log('\n疑似闪烁次数:', flickerCount);
  
  if (flickerCount > 5) {
    console.log('❌ 手牌闪烁bug仍存在!');
  } else {
    console.log('✓ 手牌闪烁已修复');
  }
  
  await browser.close();
})();
