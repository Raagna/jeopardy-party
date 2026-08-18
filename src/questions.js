const rows = [
['SCIENCE','This gas makes up about 78 percent of Earth’s atmosphere.','Nitrogen'],['SCIENCE','This is the center of an atom.','The nucleus'],['SCIENCE','H2O is the chemical formula for this.','Water'],['SCIENCE','This force keeps planets in orbit.','Gravity'],['SCIENCE','The red planet is this.','Mars'],
['HISTORY','This document begins with “We the People.”','The U.S. Constitution'],['HISTORY','This ship carried the Pilgrims to North America in 1620.','The Mayflower'],['HISTORY','This wall fell in 1989, symbolizing the end of the Cold War.','The Berlin Wall'],['HISTORY','This Egyptian queen was allied with Julius Caesar.','Cleopatra'],['HISTORY','The first person to walk on the Moon was this astronaut.','Neil Armstrong'],
['GEOGRAPHY','This is the world’s largest ocean.','The Pacific Ocean'],['GEOGRAPHY','The Nile flows into this sea.','The Mediterranean Sea'],['GEOGRAPHY','This country is home to Machu Picchu.','Peru'],['GEOGRAPHY','This is Canada’s capital city.','Ottawa'],['GEOGRAPHY','Mount Kilimanjaro is in this country.','Tanzania'],
['LITERATURE','This author wrote Romeo and Juliet.','William Shakespeare'],['LITERATURE','This wizard attends Hogwarts.','Harry Potter'],['LITERATURE','Moby-Dick features this white whale.','Moby Dick'],['LITERATURE','This detective lives at 221B Baker Street.','Sherlock Holmes'],['LITERATURE','George Orwell wrote this dystopian novel about Big Brother.','1984'],
['MOVIES','This 1997 epic features the ship Titanic.','Titanic'],['MOVIES','The Lion King’s young hero is this lion.','Simba'],['MOVIES','This green ogre is voiced by Mike Myers.','Shrek'],['MOVIES','This Pixar film follows toys led by Woody.','Toy Story'],['MOVIES','Darth Vader is a character from this franchise.','Star Wars'],
['MUSIC','This instrument has 88 keys.','Piano'],['MUSIC','This singer is nicknamed the Queen of Pop.','Madonna'],['MUSIC','This band recorded “Hey Jude.”','The Beatles'],['MUSIC','A group of three musicians is a this.','Trio'],['MUSIC','This symbol raises a note by one semitone.','Sharp'],
['SPORTS','This sport is played at Wimbledon.','Tennis'],['SPORTS','A basketball team has this many players on court.','Five'],['SPORTS','The World Cup is associated with this sport.','Soccer'],['SPORTS','In baseball, three strikes make this.','An out'],['SPORTS','This is the highest possible score in ten-pin bowling.','300'],
['FOOD & DRINK','Guacamole is traditionally made from this fruit.','Avocado'],['FOOD & DRINK','This Italian dish layers pasta, sauce and cheese.','Lasagna'],['FOOD & DRINK','Sushi often contains this seasoned rice.','Rice'],['FOOD & DRINK','Maple syrup comes from this tree.','Maple'],['FOOD & DRINK','This bean is the base of hummus.','Chickpea'],
]
export const fallbackQuestions = rows.map(([category, question, answer], i) => ({ id: String(i), category, question, answer }))

const money = (value) => Number(String(value || '').replace(/[^0-9]/g, '')) || null
const tidy = (value) => String(value || '')
  .replace(/<[^>]*>/g, '')
  .replace(/\\(['"])/g, '$1')
  .replace(/\/(['’])/g, '$1')
  .trim()

export function parseJeopardyJson(text) {
  const data = JSON.parse(text)
  if (!Array.isArray(data)) throw new Error('This JSON must be a list of Jeopardy questions.')
  const questions = data.map((row, i) => ({
    id: `json-${i}`, category: tidy(row.category).toUpperCase(), question: tidy(row.question),
    answer: tidy(row.answer), value: money(row.value), round: row.round, showNumber: row.show_number, airDate: row.air_date,
  })).filter(q => q.category && q.question && q.answer && ((q.value && (q.round === 'Jeopardy!' || q.round === 'Double Jeopardy!')) || q.round === 'Final Jeopardy!'))
  if (!questions.some(q => q.value)) throw new Error('No playable Jeopardy or Double Jeopardy clues were found.')
  return questions.sort((a, b) => (b.airDate || '').localeCompare(a.airDate || ''))
}

export function parseKaggleCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean)
  const split = (line) => { const out=[]; let cur='', quoted=false; for(let i=0;i<line.length;i++){ const c=line[i]; if(c==='"'){ if(quoted&&line[i+1]==='"'){cur+='"';i++}else quoted=!quoted } else if(c===','&&!quoted){out.push(cur);cur=''}else cur+=c } out.push(cur); return out }
  const headers = split(lines.shift()).map(x => x.trim().toLowerCase())
  const ci = headers.findIndex(x => x.includes('category')), qi = headers.findIndex(x => x.includes('question')), ai = headers.findIndex(x => x.includes('answer'))
  if (ci < 0 || qi < 0 || ai < 0) throw new Error('CSV needs category, question and answer columns.')
  return lines.map(split).map((r, i) => ({ id: `csv-${i}`, category: r[ci]?.trim().toUpperCase(), question: r[qi]?.trim(), answer: r[ai]?.trim(), value: money(r[headers.findIndex(x => x.includes('value'))]) })).filter(r => r.category && r.question && r.answer)
}

export function parseSeasonTsv(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean)
  const headers = lines.shift().split('\t').map(x => x.trim().toLowerCase())
  const column = (name) => headers.indexOf(name)
  const needed = ['round','clue_value','category','answer','question','air_date']
  if (needed.some(name => column(name) < 0)) throw new Error('This TSV does not match the Jeopardy season dataset format.')
  return lines.map((line, i) => {
    const r = line.split('\t'), roundNumber = r[column('round')]
    // The season archive labels these two columns in reverse: its `answer` cell contains the clue and `question` contains the response.
    return { id:`tsv-${i}`, category:tidy(r[column('category')]).toUpperCase(), question:tidy(r[column('answer')]), answer:tidy(r[column('question')]), value:money(r[column('clue_value')]), airDate:r[column('air_date')], round:roundNumber === '3' ? 'Final Jeopardy!' : roundNumber === '2' ? 'Double Jeopardy!' : 'Jeopardy!' }
  }).filter(q => q.category && q.question && q.answer && ((q.value && q.round !== 'Final Jeopardy!') || q.round === 'Final Jeopardy!')).sort((a, b) => (b.airDate || '').localeCompare(a.airDate || ''))
}

export async function parseSeasonZip(file) {
  const zip = await JSZip.loadAsync(file)
  const combined = Object.values(zip.files).find(entry => entry.name.endsWith('/combined_season1-42.tsv'))
  if (!combined) throw new Error('The combined season TSV was not found in this ZIP.')
  return parseSeasonTsv(await combined.async('string'))
}
import JSZip from 'jszip'
