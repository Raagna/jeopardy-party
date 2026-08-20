import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { io } from "socket.io-client";
import {
  fallbackQuestions,
  parseJeopardyJson,
  parseKaggleCsv,
  parseSeasonZip,
} from "./questions";
import "./styles.css";
import "./folders.css";
import "./archive.css";
import "./testing.css";
import "./final.css";
import "./end.css";
import "./mobile.css";
import "./turns.css";
import "./controller-answer.css";
import "./timer.css";
import "./signals.css";

const SERVER =
  import.meta.env.VITE_SERVER_URL ||
  `${location.protocol}//${location.hostname}:3001`;
const socket = io(SERVER, { autoConnect: true });
let soundContext;
function tone(frequency, duration = .16, type = "sine", volume = .12) { try { const Audio=window.AudioContext||window.webkitAudioContext; soundContext ||= new Audio(); if(soundContext.state === "suspended") soundContext.resume(); const osc=soundContext.createOscillator(), gain=soundContext.createGain(); osc.type=type;osc.frequency.value=frequency;gain.gain.setValueAtTime(volume,soundContext.currentTime);gain.gain.exponentialRampToValueAtTime(.001,soundContext.currentTime+duration);osc.connect(gain).connect(soundContext.destination);osc.start();osc.stop(soundContext.currentTime+duration) } catch {} }
function useClueMusic(active) { useEffect(()=>{ if(!active) return; let step=0; const notes=[262,330,392,330,294,349,440,349]; const play=()=>tone(notes[step++%notes.length],.3,"triangle",.035); play(); const id=setInterval(play,420); return()=>clearInterval(id) },[active]) }
const byCategory = (questions) =>
  Object.entries(
    questions
      .filter((q) => q.round !== "Final Jeopardy!")
      .reduce((a, q) => {
        const key = `${q.category}|${q.airDate || "undated"}|${q.round || "Jeopardy!"}`;
        (a[key] ||= []).push(q);
        return a;
      }, {}),
  )
    .filter(([, q]) => q.length >= 5)
    .sort((a, b) =>
      (b[1][0].airDate || "").localeCompare(a[1][0].airDate || ""),
    );
const categoryTitle = (entry) => entry[1][0].category;
const hasBoardValues = (questions, boardIndex) => {
  const step = boardIndex === 0 ? 200 : 400;
  const values = new Set(questions.map((q) => q.value));
  return [1, 2, 3, 4, 5].every((multiplier) => values.has(multiplier * step));
};
const makeCategory = ([, qs], boardIndex) => ({
  name: qs[0].category,
  airDate: qs[0].airDate,
  questions: [...qs]
    .sort((a, b) => (a.value || 0) - (b.value || 0))
    .slice(0, 5)
    .map((q, i) => ({ ...q, value: (i + 1) * (boardIndex === 0 ? 200 : 400) })),
});
const uid = () => Math.random().toString(36).slice(2);

function Setup({ onCreate }) {
  const [questions, setQuestions] = useState(fallbackQuestions),
    [search, setSearch] = useState(""),
    [board, setBoard] = useState(0),
    [picked, setPicked] = useState([[], []]),
    [final, setFinal] = useState(null),
    [notice, setNotice] = useState(""),
    [openYear, setOpenYear] = useState("All dates"),
    [visibleCount, setVisibleCount] = useState(60);
  const allCategories = useMemo(() => byCategory(questions), [questions]);
  const years = useMemo(
    () =>
      [
        ...new Set(
          allCategories
            .map(([, qs]) => qs[0].airDate?.slice(0, 4))
            .filter(Boolean),
        ),
      ].sort((a, b) => b.localeCompare(a)),
    [allCategories],
  );
  const categories = useMemo(
    () =>
      allCategories.filter(
        ([, qs]) =>
          qs[0].round === (board === 0 ? "Jeopardy!" : "Double Jeopardy!") &&
          hasBoardValues(qs, board) &&
          (openYear === "All dates" || qs[0].airDate?.startsWith(openYear)) &&
          qs[0].category.includes(search.toUpperCase()),
      ),
    [allCategories, openYear, search, board],
  );
  const select = (entry) =>
    setPicked((p) =>
      p.map((b, i) =>
        i === board
          ? b.some((x) => x[0] === entry[0])
            ? b.filter((x) => x[0] !== entry[0])
            : b.length < 6 &&
                !b.some((x) => categoryTitle(x) === categoryTitle(entry))
              ? [...b, entry]
              : b
          : b,
      ),
    );
  const randomize = () =>
    setPicked((p) =>
      p.map((b, i) =>
        i === board
          ? (() => {
              const pool = categories
                .filter(
                  (e) => !b.some((x) => categoryTitle(x) === categoryTitle(e)),
                )
                .sort(() => Math.random() - 0.5);
              return [...b, ...pool.slice(0, 6 - b.length)];
            })()
          : b,
      ),
    );
  useEffect(() => setVisibleCount(60), [search, openYear, questions]);
  const start = () => {
    if (picked[0].length !== 6 || picked[1].length !== 6)
      return setNotice("Choose six categories for each board.");
    const finalPool = questions.filter((q) => q.round === "Final Jeopardy!");
    const finalQ =
      final ||
      finalPool[Math.floor(Math.random() * finalPool.length)] ||
      questions[Math.floor(Math.random() * questions.length)];
    onCreate({ boards: picked.map((b, boardIndex) => b.map((entry) => makeCategory(entry, boardIndex))), final: finalQ });
  };
  return (
    <main className="setup">
      <div className="brand">
        JEOPARDY! <span>local game night</span>
      </div>
      <section className="setup-card">
        <div className="setup-top">
          <div>
            <p className="eyebrow">HOST SETUP</p>
            <h1>Build your game board</h1>
            <p className="muted">
              Browse dated question sets, then choose direct dataset categories.
            </p>
          </div>
          <label className="upload">
            Import JSON / CSV / Season ZIP
            <input
              type="file"
              accept=".json,.csv,.zip"
              onChange={async (e) => {
                try {
                  const file = e.target.files[0];
                  setNotice(`Loading ${file.name}…`);
                  const q = file.name.endsWith(".zip")
                    ? await parseSeasonZip(file)
                    : file.name.endsWith(".json")
                      ? parseJeopardyJson(await file.text())
                      : parseKaggleCsv(await file.text());
                  setQuestions(q);
                  setPicked([[], []]);
                  setFinal(null);
                  setOpenYear("All dates");
                  setNotice(`${q.length.toLocaleString()} clues loaded.`);
                } catch (err) {
                  setNotice(err.message);
                }
              }}
            />
          </label>
        </div>
        <div className="tabs">
          <button
            className={board === 0 ? "active" : ""}
            onClick={() => setBoard(0)}
          >
            Jeopardy · {picked[0].length}/6
          </button>
          <button
            className={board === 1 ? "active" : ""}
            onClick={() => setBoard(1)}
          >
            Double Jeopardy · {picked[1].length}/6
          </button>
          <button className="randomize" onClick={randomize}>
            ⚄ Random remaining
          </button>
        </div>
        <div className="builder">
          <div>
            <div className="archive-controls">
              <input
                className="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search categories…"
              />
              <select
                value={openYear}
                onChange={(e) => setOpenYear(e.target.value)}
              >
                <option>All dates</option>
                {years.map((year) => (
                  <option key={year}>{year}</option>
                ))}
              </select>
            </div>
            <div
              className="category-list"
              onScroll={(e) => {
                const el = e.currentTarget;
                if (el.scrollTop + el.clientHeight >= el.scrollHeight - 30)
                  setVisibleCount((n) => Math.min(n + 60, categories.length));
              }}
            >
              {categories.slice(0, visibleCount).map((entry) => (
                <button
                  key={entry[0]}
                  className={
                    picked[board].some((x) => x[0] === entry[0]) ? "chosen" : ""
                  }
                  onClick={() => select(entry)}
                >
                  <span>{categoryTitle(entry)}</span>
                  <small>
                    {entry[1][0].airDate || "Undated"} ·{" "}
                    {entry[1][0].round || "Jeopardy!"}
                  </small>
                </button>
              ))}
              {visibleCount < categories.length && (
                <div className="load-more">Scroll for more categories…</div>
              )}
            </div>
          </div>
          <div className="selected">
            <p className="eyebrow">ROUND {board + 1} BOARD</p>
            {picked[board].map((x) => (
              <div className="pill" key={x[0]}>
                {categoryTitle(x)} <small>{x[1][0].airDate}</small>
                <button onClick={() => select(x)}>×</button>
              </div>
            ))}
            {Array.from({ length: 6 - picked[board].length }).map((_, i) => (
              <div className="empty" key={i}>
                Choose a category
              </div>
            ))}
          </div>
        </div>
        <div className="final-row">
          <div>
            <p className="eyebrow">FINAL JEOPARDY</p>
            <select
              value={final?.id || ""}
              onChange={(e) =>
                setFinal(questions.find((q) => q.id === e.target.value) || null)
              }
            >
              <option value="">Random Final Jeopardy clue</option>
              {questions
                .filter((q) => q.round === "Final Jeopardy!")
                .map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.airDate} · {q.category}: {q.question.slice(0, 52)}
                  </option>
                ))}
            </select>
          </div>
          <button className="primary" onClick={start}>
            Create lobby →
          </button>
        </div>
        {notice && <p className="notice">{notice}</p>}
      </section>
    </main>
  );
}

function Scores({ players }) {
  return (
    <div className="scores">
      {players.map((p) => (
        <div key={p.id}>
          <b>{p.name}</b>
          <span>${p.score.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}
function ClueTimer({ deadline, serverNow }) {
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    if (!deadline) return;
    const startedAt=Date.now(), startRemaining=Math.max(0,deadline-serverNow);
    const update=()=>setRemaining(Math.max(0,startRemaining-(Date.now()-startedAt)));
    update(); const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [deadline,serverNow]);
  if (!deadline) return null;
  return <div className="clue-timer">{Math.ceil(remaining / 1000)}s</div>;
}
function Display({ game, host = false, onAction }) {
  const q = game.activeQuestion?.question;
  const buzzed = game.players.find((p) => p.id === game.buzzedPlayer);
  const boardDone = game.board?.every((c) => c.questions.every((q) => q.used));
  useClueMusic(Boolean(game.activeQuestion && game.buzzerOpen));
  useEffect(() => {
    if (game.lastEvent?.type === "reveal") tone(1047, .55, "sine", .16);
  }, [game.lastEvent?.at]);
  return (
    <main className="display">
      <header>
        <div className="brand">JEOPARDY!</div>
        <div className="code">
          JOIN AT <b>raagna.github.io/jeopardy-party/</b> · CODE <strong>{game.code}</strong>
          {game.activeQuestion && <ClueTimer deadline={game.answerDeadline || game.clueDeadline} serverNow={game.serverNow} />}
        </div>
      </header>
      {game.status === "lobby" ? (
        <div className="waiting">
          <p className="eyebrow">WAITING FOR PLAYERS</p>
          <h1>Join the game</h1>
          <div className="lobby-code">{game.code}</div>
          <p>Open this page on your phone and enter the code.</p>
          <Scores players={game.players} />
          {host && (
            <button className="primary" onClick={() => onAction("start")}>
              Start game
            </button>
          )}
        </div>
      ) : game.activeQuestion ? (
        <div className="clue-screen">
          <p className="eyebrow">
            {game.activeQuestion.dailyDouble && !game.activeQuestion.dailyReady ? "DAILY DOUBLE" : `${q.category} · ${q.value || "FINAL"}`}
          </p>
          <h1>{game.activeQuestion.dailyDouble && !game.activeQuestion.dailyReady ? "Wager required" : q.question}</h1>
          {game.reveal && <div className="answer">{q.answer}</div>}
          {buzzed && <div className="buzzed">{buzzed.name} buzzed in</div>}
        </div>
      ) : game.status === "final" ? (
        <div className="clue-screen">
          <p className="eyebrow">FINAL JEOPARDY</p>
          <h1>Ready for the final clue</h1>
        </div>
      ) : (
        <>
          <div className="round-title">
            {game.boardIndex === 0 ? "JEOPARDY!" : "DOUBLE JEOPARDY!"}
          </div>
          <div className="board">
            {game.board.map((c, ci) => (
              <div className="column" key={c.name}>
                <div className="cat">{c.name}</div>
                {c.questions.map((q, qi) => (
                  <button
                    disabled={q.used || !host}
                    onClick={() =>
                      onAction("select", {
                        categoryIndex: ci,
                        questionIndex: qi,
                      })
                    }
                    key={q.id}
                    className={q.used ? "used" : ""}
                  >
                    ${q.value}
                  </button>
                ))}
              </div>
            ))}
          </div>
          {host && (
            <div className="host-bottom">
              {boardDone && (
                <button
                  className="primary"
                  onClick={() =>
                    onAction(game.boardIndex === 0 ? "nextBoard" : "final")
                  }
                >
                  {game.boardIndex === 0
                    ? "Start Double Jeopardy"
                    : "Final Jeopardy"}
                </button>
              )}
            </div>
          )}
        </>
      )}
      <Scores players={game.players} />
    </main>
  );
}
function Controller({ game, onAction }) {
  const buzzed = game.players.find((p) => p.id === game.buzzedPlayer),
    finalMode = game.status === "final";
  const skip = () => onAction(game.boardIndex === 0 ? "nextBoard" : "final");
  return (
    <main className="controller">
      <p className="eyebrow">HOST CONTROLLER · {game.code}</p>
      <h1>
        {finalMode
          ? "Final Jeopardy"
          : game.activeQuestion
            ? "Clue controls"
            : "Board controls"}
      </h1>
      {finalMode ? (
        <>
          <button className="wide" onClick={() => onAction("reveal")}>
            {game.reveal ? "Hide final answer" : "Reveal final answer"}
          </button>
          {game.players.map((p) => {
            const r = game.finalResponses.find((x) => x.playerId === p.id);
            return (
              <div className="judgement" key={p.id}>
                <h2>
                  {p.name} {r ? "— submitted" : "— waiting"}
                </h2>
                {r && (
                  <>
                    <p>
                      Wager: <b>${r.wager}</b>
                    </p>
                    <button
                      className="wide"
                      onClick={() =>
                        onAction("revealFinalPlayer", { playerId: p.id })
                      }
                    >
                      {r.revealed ? "Hide response" : "Reveal response"}
                    </button>
                    {r.revealed && (
                      <p className="final-response">{r.response}</p>
                    )}
                    <div>
                      <button
                        onClick={() =>
                          onAction("score", { playerId: p.id, amount: r.wager })
                        }
                      >
                        Correct +${r.wager}
                      </button>
                      <button
                        onClick={() =>
                          onAction("score", {
                            playerId: p.id,
                            amount: -r.wager,
                          })
                        }
                      >
                        Incorrect −${r.wager}
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
          <button className="close" onClick={() => onAction("close")}>
            Finish game
          </button>
        </>
      ) : game.activeQuestion ? (
        <>
          {game.activeQuestion.dailyDouble && <p className="turn-note">Daily Double {game.activeQuestion.dailyReady ? `— wager $${game.activeQuestion.dailyWager}` : "— waiting for wager"}</p>}
          <div className="controller-answer">
            <span>Correct response</span>
            {game.activeQuestion.question.answer}
          </div>
          {!game.activeQuestion.dailyDouble && <button
            className={"wide " + (game.buzzerOpen ? "on" : "")}
            onClick={() => onAction("buzzer", { open: !game.buzzerOpen })}
          >
            {game.buzzerOpen ? "BUZZERS OPEN — close" : "Open buzzers"}
          </button>}
          {buzzed && (
            <div className="judgement">
              <h2>{buzzed.name}</h2>
              <div>
                <button
                  onClick={() =>
                    onAction("score", {
                      playerId: buzzed.id,
                      amount: game.activeQuestion.question.value || 1000,
                    })
                  }
                >
                  Correct +${game.activeQuestion.question.value || 1000}
                </button>
                <button
                  onClick={() =>
                    onAction("score", {
                      playerId: buzzed.id,
                      amount: -(game.activeQuestion.question.value || 1000),
                    })
                  }
                >
                  Incorrect −${game.activeQuestion.question.value || 1000}
                </button>
              </div>
            </div>
          )}
          <button className="close" onClick={() => onAction("close")}>
            Close clue / return to board
          </button>
        </>
      ) : (
        <p className="muted">
          Pick a clue on the shared display, then control it here.
        </p>
      )}
      {game.status === "playing" && (
        <button className="skip-controller" onClick={skip}>
          {game.boardIndex === 0
            ? "Skip to Double Jeopardy →"
            : "Skip to Final Jeopardy →"}
        </button>
      )}
      <Scores players={game.players} />
    </main>
  );
}
function FinalPlayer({ game, playerId, p }) {
  const [wager, setWager] = useState("0"),
    [response, setResponse] = useState(""),
    [error, setError] = useState("");
  const submitted = game.finalResponses.find((x) => x.playerId === playerId);
  if (p.score < 1)
    return <p className="locked-final">You are not eligible for Final Jeopardy.</p>;
  if (submitted)
    return (
      <p className="locked-final">
        Final response locked — wager: ${submitted.wager}
      </p>
    );
  const submit = () =>
    socket.emit(
      "player:finalSubmit",
      { code: game.code, playerId, wager, response },
      (r) => !r.ok && setError(r.error),
    );
  return (
    <div className="final-form">
      <p>Wager from $0 to ${Math.max(0, p.score)}</p>
      <input
        type="number"
        min="0"
        max={Math.max(0, p.score)}
        value={wager}
        onChange={(e) => setWager(e.target.value)}
      />
      <textarea
        value={response}
        onChange={(e) => setResponse(e.target.value)}
        placeholder="Type your response…"
      />
      <button className="primary" onClick={submit}>
        Lock in response
      </button>
      {error && <p className="notice">{error}</p>}
    </div>
  );
}
function DailyWager({ game, playerId, player }) {
  const [wager,setWager]=useState("5"); const max=Math.max(player.score,game.boardIndex===0?1000:2000,5)
  if(game.activeQuestion.dailyReady) return <><p className="locked-final">Your wager is locked: ${game.activeQuestion.dailyWager}</p><button className="buzzer ready" disabled={!!game.buzzedPlayer} onClick={()=>socket.emit("player:buzz",{code:game.code,playerId})}>BUZZ!</button></>
  return <div className="final-form"><p>DAILY DOUBLE! Wager $5 to ${max}</p><input type="number" min="5" max={max} value={wager} onChange={e=>setWager(e.target.value)}/><button className="primary" onClick={()=>socket.emit("player:dailyWager",{code:game.code,playerId,wager})}>Lock wager</button></div>
}
function Player({ game, playerId }) {
  const p = game.players.find((p) => p.id === playerId);
  const buzzed = game.players.find((p) => p.id === game.buzzedPlayer),
    hasTurn = game.answeringPlayerId === playerId,
    chooser = game.players.find((p) => p.id === game.turnPlayerId),
    lockedOut = game.incorrectPlayerIds?.includes(playerId);
  const signal = game.lastEvent?.playerId === playerId ? game.lastEvent.type : "";
  useClueMusic(game.buzzerOpen || game.status === "final");
  useEffect(() => { if(signal === "correct") tone(880,.28); if(signal === "incorrect") tone(150,.35); if(signal === "daily") tone(660,4,"sawtooth"); if(game.lastEvent?.type === "reveal") tone(1047,.55,"sine",.16); }, [game.lastEvent?.at]);
  return (
    <main className={`player ${signal === "correct" ? "signal-correct" : signal === "incorrect" ? "signal-incorrect" : ""}`}>
      <div className="brand">JEOPARDY!</div>
      <h2>{p?.name}</h2>
      <div className="player-score">${p?.score?.toLocaleString() || 0}</div>
      {game.status === "lobby" ? (
        <p>Waiting for the host to start…</p>
      ) : game.status === "final" ? (
        <FinalPlayer game={game} playerId={playerId} p={p} />
      ) : game.activeQuestion?.dailyDouble ? (
        game.activeQuestion.dailyPlayerId===playerId ? <DailyWager game={game} playerId={playerId} player={p}/> : <p className="player-status">A Daily Double is in play.</p>
      ) : (
        <>
          <p className="player-status">
            {lockedOut
              ? "Incorrect — wait for the next clue."
              : buzzed
                  ? buzzed.id === playerId ? "You buzzed first — answer now!" : `${buzzed.name} buzzed first.`
                  : game.buzzerOpen
                    ? "Buzz in!"
                    : "Wait for the host to open buzzers."}
          </p>
          <button
            className={"buzzer " + (game.buzzerOpen ? "ready" : "")}
            disabled={lockedOut || !!game.buzzedPlayer || !game.buzzerOpen}
            onClick={() => { tone(420,.1,"square"); socket.emit("player:buzz", { code: game.code, playerId }); }}
          >
            BUZZ!
          </button>
        </>
      )}
    </main>
  );
}
function Join({ onJoined }) {
  const [code, setCode] = useState(""),
    [name, setName] = useState(sessionStorage.playerName || ""),
    [error, setError] = useState("");
  const join = () => { tone(1,.01,"sine",.001); socket.emit("player:join", { code, name, returningPlayerId: sessionStorage.playerId }, (r) =>
      r.ok ? onJoined(r.game, r.playerId) : setError(r.error),
    ); };
  return (
    <main className="join">
      <div className="brand">JEOPARDY!</div>
      <h1>{sessionStorage.playerId ? "Rejoin your game" : "Join a game"}</h1>
      <input
        placeholder="Game code"
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
      />
      <input
        placeholder="Your name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <button className="primary" onClick={join}>
        Join lobby
      </button>
      {error && <p className="notice">{error}</p>}
      <a href="?host">Hosting a game?</a>
    </main>
  );
}
function EndGame({ game, host, onReplay }) {
  const ranked=[...game.players].sort((a,b)=>b.score-a.score), top=ranked.slice(0,3), rest=ranked.slice(3);
  return (
    <main className="waiting">
      <p className="eyebrow">GAME COMPLETE</p>
      <h1>Final standings</h1>
      <div className="podium">{top.map((p,i)=><div className={`place place-${i+1}`} key={p.id}><span>#{i+1}</span><b>{p.name}</b><strong>${p.score}</strong></div>)}</div>
      {rest.length>0&&<div className="remaining-players">{rest.map((p,i)=><div key={p.id}>#{i+4} {p.name}<b>${p.score}</b></div>)}</div>}
      {host ? (
        <div className="end-actions">
          <button className="new-game" onClick={() => location.assign("?host")}>
            New game
          </button>
        </div>
      ) : (
        <div className="player-end"><p>Thanks for playing!</p><button className="new-game" onClick={()=>{sessionStorage.removeItem("playerId");sessionStorage.removeItem("gameCode");sessionStorage.removeItem("playerName");location.assign("./")}}>New game</button></div>
      )}
    </main>
  );
}
function App() {
  const params = new URLSearchParams(location.search),
    host = params.has("host"),
    controller = params.has("controller");
  const [game, setGame] = useState(null),
    [playerId, setPlayerId] = useState(sessionStorage.playerId);
  useEffect(() => {
    socket.on("game:update", setGame);
    return () => socket.off("game:update");
  }, []);
  const action = (action, payload = {}) =>
    socket.emit("host:action", { code: game.code, action, payload });
  if (!game) {
    if (host)
      return (
        <Setup
          onCreate={(config) =>
            socket.emit("host:create", config, (r) => {
              setGame(r.game);
              history.replaceState({}, "", "?host");
            })
          }
        />
      );
    if (controller) {
      const code = sessionStorage.hostCode || prompt("Enter host game code");
      if (code)
        socket.emit("host:join", { code }, (r) => r.ok && setGame(r.game));
      return <main className="join">Connecting controller…</main>;
    }
    return (
      <Join
        onJoined={(g, p) => {
          sessionStorage.playerId = p;
          sessionStorage.gameCode = g.code;
          sessionStorage.playerName = g.players.find((player) => player.id === p)?.name || "";
          setPlayerId(p);
          setGame(g);
        }}
      />
    );
  }
  if (game.status === "complete")
    return (
      <EndGame
        game={game}
        host={host || controller}
        onReplay={() => action("replay")}
      />
    );
  if (controller) return <Controller game={game} onAction={action} />;
  if (host)
    return (
      <>
        <Display game={game} host onAction={action} />
        <a
          className="controller-link"
          onClick={() => {
            sessionStorage.hostCode = game.code;
            window.open("?controller", "_blank");
          }}
        >
          Open host controller ↗
        </a>
      </>
    );
  return <Player game={game} playerId={playerId} />;
}
createRoot(document.getElementById("root")).render(<App />);
