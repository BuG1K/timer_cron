import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { load } from 'cheerio';
import TelegramBot from 'node-telegram-bot-api';
import parseStatus from './parseStatus.js';
import fs from 'fs';

dotenv.config();

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
const CHAT_ID = process.env.CHAT_ID;

let lastMatches = {}; // id: {score, minute, ...}

function extractId(link) {
  const match = link.match(/id=(\d+)/);
  return match ? match[1] : null;
}

function getLeagueName(text) {
  // Убираем всё в скобках
  return text.replace(/\s*\(.*?\)/, '').trim();
}

function splitTeams(teams) {
  // Пример: "Калгари Флэймз (SH0OZY) - Колорадо Эвеланш (OBEREG19)"
  const [team1Full, team2Full] = teams.split(' - ').map(s => s.trim());

  // Извлекаем название и игрока
  const team1Match = team1Full.match(/^(.+?)\s*\((.+?)\)$/);
  const team2Match = team2Full.match(/^(.+?)\s*\((.+?)\)$/);

  return {
    team1: team1Match ? team1Match[1].trim() : team1Full,
    gamer1: team1Match ? team1Match[2].trim() : null,
    team2: team2Match ? team2Match[1].trim() : team2Full,
    gamer2: team2Match ? team2Match[2].trim() : null,
  };
}

function loadFinishedMatches() {
  try {
    return JSON.parse(fs.readFileSync('finished.json', 'utf-8'));
  } catch {
    return [];
  }
}

function saveFinishedMatches(finished) {
  fs.writeFileSync('finished.json', JSON.stringify(finished, null, 2), 'utf-8');
}

function getScoreParts(score) {
  if (!score) return [0, 0];
  const [h, a] = score.split(':').map(Number);
  return [h || 0, a || 0];
}

async function parseSite() {
  console.log('Parsing site...');
  const res = await fetch('https://betz.su/livebc.php?sport=%D0%9A%D0%B8%D0%B1%D0%B5%D1%80%D1%85%D0%BE%D0%BA%D0%BA%D0%B5%D0%B9', {
    headers: {
      'User-Agent': 'Mozilla/5.0',
    },
  });
  const html = await res.text();
  const $ = load(html);

  const mainBlock = $('#main').eq(1);

  const result = [];
  let currentLeague = '';

  mainBlock.find('div.sports').each((i, el) => {
    const style = $(el).attr('style') || '';
    if (style.includes('font-weight:bold')) {
      currentLeague = getLeagueName($(el).text());
    } else {
      const time = $(el).find('i').text().trim();
      const link = $(el).find('a').attr('href');
      const id = extractId(link);
      const teamsText = $(el).find('a').text().trim();
      const status = $(el).find('span').text().trim();
      const { team1, gamer1, team2, gamer2 } = splitTeams(teamsText);

      result.push({
        id,
        league: currentLeague,
        time,
        teams: teamsText,
        team1,
        gamer1,
        team2,
        gamer2,
        status: parseStatus(status),
      });
    }
  });

  // Сохраняем текущие матчи по id
  const currentIds = new Set(result.map(m => m.id));
  const prevMatches = lastMatches;
  lastMatches = {};
  result.forEach(m => { lastMatches[m.id] = m; });

  // --- Новый блок: определяем голы ---
  for (const match of result) {
    const prev = prevMatches[match.id];
    // Инициализируем goals, если не было
    match.goals = prev && prev.goals ? [...prev.goals] : [];

    if (!prev) continue;

    // Сравниваем счёт
    const [prevHome, prevAway] = getScoreParts(prev.status.score);
    const [currHome, currAway] = getScoreParts(match.status.score);

    // Если изменился счёт
    if (currHome !== prevHome || currAway !== prevAway) {
      // Определяем, кто забил и сколько раз (если разница больше 1)
      if (currHome > prevHome) {
        for (let i = 0; i < currHome - prevHome; i++) {
          match.goals.push({ minute: match.status.minute, team: match.team1 });
        }
      }
      if (currAway > prevAway) {
        for (let i = 0; i < currAway - prevAway; i++) {
          match.goals.push({ minute: match.status.minute, team: match.team2 });
        }
      }
    }
  }

  // Загружаем завершённые матчи
  let finished = loadFinishedMatches();

  // Проверяем, какие матчи пропали (значит, завершились)
  for (const id in prevMatches) {
    if (!currentIds.has(id)) {
      // Добавляем только если ещё не в finished
      if (!finished.find(m => m.id === id)) {
        const match = { ...prevMatches[id], finished: true };
        finished.push(match);
      }
    }
  }

  // Сохраняем файлы
  fs.writeFileSync('result.json', JSON.stringify(result, null, 2), 'utf-8');
  saveFinishedMatches(finished);
}

// Telegram bot: команда для вывода последних 50 завершённых игр
bot.onText(/\/last50/, (msg) => {
  const chatId = msg.chat.id;
  let finished = [];
  try {
    finished = JSON.parse(fs.readFileSync('finished.json', 'utf-8'));
  } catch {
    bot.sendMessage(chatId, 'Нет завершённых игр.');
    return;
  }

  if (!finished.length) {
    bot.sendMessage(chatId, 'Нет завершённых игр.');
    return;
  }

  // Берём последние 50 игр
  const lastGames = finished.slice(-50).reverse();
  let text = lastGames.map(game => {
    let goalsText = '';
    if (game.goals && game.goals.length) {
      goalsText = 'Голы:\n' + game.goals.map(g => `  ${g.minute ? g.minute + ' мин' : ''} — ${g.team}`).join('\n');
    }
    return `${game.time} | ${game.league}\n${game.teams}\nСчёт: ${game.status.score}\n${goalsText}\n`;
  }).join('\n');

  // Если слишком длинно — разбиваем на части (Telegram лимит 4096 символов)
  if (text.length > 4000) {
    const parts = [];
    while (text.length > 0) {
      parts.push(text.slice(0, 4000));
      text = text.slice(4000);
    }
    parts.forEach(part => bot.sendMessage(chatId, part));
  } else {
    bot.sendMessage(chatId, text);
  }
});

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, 'Привет! Напиши /last50 чтобы получить последние 50 завершённых игр.');
});

setInterval(parseSite, 1 * 60 * 1000);
parseSite();
