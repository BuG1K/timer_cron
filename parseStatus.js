function parseStatus(status) {
  const result = {
    score: null,
    period1: null,
    period2: null,
    period3: null,
    periodNow: null,
    minute: null,
    finished: false,
    raw: status
  };

  // Проверка на завершённость по ключевым словам
  if (/матч завершен/i.test(status)) {
    result.finished = true;
  }

  // Счёт (до скобок)
  const scoreMatch = status.match(/^([\d:]+)\s?/);
  if (scoreMatch) {
    result.score = scoreMatch[1];
  }

  // Периоды (в скобках)
  const setsMatch = status.match(/\(([^)]+)\)/);
  let periods = [];
  if (setsMatch) {
    periods = setsMatch[1].split(',').map(s => s.trim());
  }

  // Период (номер)
  const periodMatch = status.match(/(\d+)(?:-й)?\s?период/i);
  if (periodMatch) {
    result.periodNow = Number(periodMatch[1]);
  }

  // Минута
  const minuteMatch = status.match(/(\d+)\s?мин/);
  if (minuteMatch) {
    result.minute = Number(minuteMatch[1]);
  }

  // Автоматически рассчитываем периоды
  // Получаем общий счёт
  let totalHome = 0, totalAway = 0;
  if (result.score) {
    const [home, away] = result.score.split(':').map(Number);
    totalHome = home;
    totalAway = away;
  }

  // Считаем периоды
  let sumHome = 0, sumAway = 0;
  for (let i = 0; i < 3; i++) {
    if (periods[i]) {
      const [h, a] = periods[i].split(':').map(Number);
      sumHome += h;
      sumAway += a;
      result[`period${i + 1}`] = `${h}:${a}`;
    } else if (i === periods.length && result.periodNow && result.periodNow > periods.length) {
      // Если период идёт, но данных нет — считаем разницу
      const h = totalHome - sumHome;
      const a = totalAway - sumAway;
      result[`period${i + 1}`] = `${h}:${a}`;
    } else if (i === 0 && periods.length === 0 && result.score) {
      // Если только первый период и нет скобок
      result.period1 = result.score;
    } else {
      result[`period${i + 1}`] = null;
    }
  }

  // Если только первый период и нет скобок
  if (!setsMatch && result.score) {
    result.period1 = result.score;
    result.period2 = '0:0';
    result.period3 = '0:0';
  }

  // Если матч завершён и не хватает периодов — добиваем нулями
  if (result.finished) {
    for (let i = 0; i < 3; i++) {
      if (!result[`period${i + 1}`]) result[`period${i + 1}`] = '0:0';
    }
  }

  return result;
}

export default parseStatus;
