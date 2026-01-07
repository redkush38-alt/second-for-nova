import React, { useState, useEffect, useRef, useCallback } from 'react';
import './superstudent.css';

const OPS = ['+', '-', '*', '/'];
const ATTEMPT_LIMIT = 400;
const GAME_NAME = "Equation Builder";

const SuperStudent = () => {
    // --- State ---
    const [score, setScore] = useState(0);
    const [timeLeft, setTimeLeft] = useState(60);
    const [currentLevel, setCurrentLevel] = useState(1);
    const [gameStarted, setGameStarted] = useState(false);
    const [targetValue, setTargetValue] = useState(null);
    const [originalExpr, setOriginalExpr] = useState("");
    const [originalTokens, setOriginalTokens] = useState([]);
    const [availableTokens, setAvailableTokens] = useState([]);
    const [equationTokens, setEquationTokens] = useState([]);
    const [solutionVisible, setSolutionVisible] = useState(false);
    const [activePopup, setActivePopup] = useState('welcome');
    const [wrongAnswerData, setWrongAnswerData] = useState({ expr: '', result: null, message: '' });
    const [hint, setHint] = useState(null);

    const timerRef = useRef(null);
    const currentQuestionRef = useRef(null);

    // --- Utils ---
    const randInt = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
    const genId = () => Math.random().toString(36).slice(2, 9);

    const shuffleArray = (arr) => {
        const newArr = [...arr];
        for (let i = newArr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
        }
        return newArr;
    };

    const tokenize = (expr) => {
        const re = /(\d+|\+|\-|\*|\/|\(|\))/g;
        return expr.match(re) || [];
    };

    const safeEval = (expr) => {
        if (!/^[0-9+\-*/()]+$/.test(expr)) throw new Error("Unsafe expression");
        return new Function('"use strict"; return (' + expr + ');')();
    };

    const balancedParens = (s) => {
        let c = 0;
        for (const ch of s) {
            if (ch === '(') c++;
            else if (ch === ')') {
                c--;
                if (c < 0) return false;
            }
        }
        return c === 0;
    };

    const getOperatorWeights = (level) => {
        if (level <= 3) return { '+': 0.5, '-': 0.3, '*': 0.15, '/': 0.05 };
        if (level <= 6) return { '+': 0.3, '-': 0.2, '*': 0.35, '/': 0.15 };
        return { '+': 0.2, '-': 0.15, '*': 0.3, '/': 0.35 };
    };

    const getWeightedRandomOperator = (weights) => {
        const random = Math.random();
        let cumulative = 0;
        for (const [op, weight] of Object.entries(weights)) {
            cumulative += weight;
            if (random <= cumulative) return op;
        }
        return '+';
    };

    const getTimerDurationForLevel = (level) => {
        const baseTime = 60;
        const timeBonus = Math.max(0, 10 - (level - 1) * 2);
        return Math.max(30, baseTime + timeBonus);
    };

    // --- API Fallbacks ---
    const fetchWithFallback = useCallback(async (url, options = {}, mockData = null) => {
        try {
            const response = await fetch(url, options);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            return await response.json();
        } catch (error) {
            console.warn(`API call to ${url} failed, using mock data.`, error);
            return mockData;
        }
    }, []);

    const loadSavedProgress = useCallback(async () => {
        const mockProgress = { success: true, level: 1 };
        const data = await fetchWithFallback(`/get_progress/${encodeURIComponent(GAME_NAME)}`, {}, mockProgress);
        if (data && data.success && data.level) {
            setCurrentLevel(data.level);
        }
    }, [fetchWithFallback]);

    const saveProgress = useCallback(async (level) => {
        await fetchWithFallback('/save_progress', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ game_name: GAME_NAME, level })
        }, { success: true });
    }, [fetchWithFallback]);

    const logGameEnd = useCallback(async () => {
        await fetchWithFallback('/api/game/end', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ game_name: GAME_NAME })
        }, { success: true });
        window.location.href = "/games";
    }, [fetchWithFallback]);

    // --- Game Logic ---
    const buildRandomExpr = useCallback((numbers, ops) => {
        let items = numbers.map(n => ({ expr: String(n), value: n }));
        const opsCopy = [...ops];
        while (items.length > 1) {
            const i = randInt(0, items.length - 1);
            let j = randInt(0, items.length - 1);
            while (j === i) j = randInt(0, items.length - 1);
            const op = opsCopy.shift() ?? OPS[Math.floor(Math.random() * OPS.length)];
            const leftFirst = Math.random() < 0.5;
            const a = leftFirst ? items[i] : items[j];
            const b = leftFirst ? items[j] : items[i];
            const newExpr = '(' + a.expr + op + b.expr + ')';
            try {
                const newVal = safeEval(newExpr);
                if (!Number.isFinite(newVal)) throw new Error('badVal');
                const idxs = [i, j].sort((x, y) => y - x);
                idxs.forEach(idx => items.splice(idx, 1));
                items.push({ expr: newExpr, value: newVal });
                items = shuffleArray(items);
            } catch (e) {
                opsCopy.unshift(op);
                items = shuffleArray(items);
                continue;
            }
        }
        return items[0].expr;
    }, []);

    const startTimer = useCallback((seconds) => {
        if (timerRef.current) clearInterval(timerRef.current);
        setTimeLeft(seconds);
        timerRef.current = setInterval(() => {
            setTimeLeft(prev => {
                if (prev <= 1) {
                    clearInterval(timerRef.current);
                    setActivePopup('timeUp');
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
    }, []);

    const newRound = useCallback((numCount = null) => {
        const level = currentLevel;
        const count = numCount || Math.min(3 + Math.floor((level - 1) / 3), 6);
        const timerDuration = getTimerDurationForLevel(level);

        startTimer(timerDuration);
        setEquationTokens([]);
        setSolutionVisible(false);
        setHint(null);
        setActivePopup(null);

        let tries = 0;
        while (tries < ATTEMPT_LIMIT) {
            tries++;
            const maxNumber = Math.min(9, 3 + Math.floor(level / 2));
            const numbers = Array.from({ length: count }, () => randInt(1, maxNumber));
            const opWeights = getOperatorWeights(level);
            const ops = Array.from({ length: count - 1 }, () => getWeightedRandomOperator(opWeights));
            const expr = buildRandomExpr(numbers, ops);

            try {
                const val = safeEval(expr);
                if (!Number.isFinite(val)) continue;
                if (Math.abs(val - Math.round(val)) > 1e-9) continue;
                const rounded = Math.round(val);
                if (Math.abs(rounded) > 1000) continue;

                const tokens = tokenize(expr);
                const available = tokens.map(t => ({ id: genId(), token: t, used: false }));

                setOriginalExpr(expr);
                setOriginalTokens(tokens);
                setTargetValue(rounded);
                setAvailableTokens(shuffleArray(available));
                currentQuestionRef.current = {
                    originalExpr: expr,
                    originalTokens: [...tokens],
                    targetValue: rounded,
                    numCount: count
                };
                return;
            } catch (e) {
                continue;
            }
        }

        // Fallback
        const fallbackExpr = "(3+4)*2";
        const fallbackTokens = tokenize(fallbackExpr);
        const fallbackTarget = 14;
        setOriginalExpr(fallbackExpr);
        setOriginalTokens(fallbackTokens);
        setTargetValue(fallbackTarget);
        setAvailableTokens(shuffleArray(fallbackTokens.map(t => ({ id: genId(), token: t, used: false }))));
    }, [currentLevel, buildRandomExpr, startTimer]);

    const addToEquation = (index) => {
        const token = availableTokens[index];
        if (token.used) return;
        const newAvailable = [...availableTokens];
        newAvailable[index].used = true;
        setAvailableTokens(newAvailable);
        setEquationTokens([...equationTokens, { id: token.id, token: token.token }]);
    };

    const removeFromEquation = (index) => {
        const removed = equationTokens[index];
        const newEquation = [...equationTokens];
        newEquation.splice(index, 1);
        setEquationTokens(newEquation);
        const newAvailable = availableTokens.map(t =>
            t.id === removed.id ? { ...t, used: false } : t
        );
        setAvailableTokens(newAvailable);
    };

    const resetEquation = () => {
        setEquationTokens([]);
        setAvailableTokens(availableTokens.map(t => ({ ...t, used: false })));
        setSolutionVisible(false);
        setHint(null);
    };

    const checkEquation = () => {
        const exprStr = equationTokens.map(t => t.token).join('');
        const cleanExprStr = exprStr.replace(/\s+/g, '');

        if (!/^[0-9+\-*/()]+$/.test(cleanExprStr)) {
            setWrongAnswerData({ expr: cleanExprStr, result: null, message: 'Invalid characters detected.' });
            setActivePopup('wrongAnswer');
            return;
        }

        if (!balancedParens(cleanExprStr)) {
            setWrongAnswerData({ expr: cleanExprStr, result: null, message: 'Parentheses are not balanced.' });
            setActivePopup('wrongAnswer');
            return;
        }

        try {
            const val = safeEval(cleanExprStr);
            const rounded = Math.round(val);

            if (Math.abs(val - rounded) > 1e-9) {
                setWrongAnswerData({ expr: cleanExprStr, result: val, message: 'Must evaluate to a whole number.' });
                setActivePopup('wrongAnswer');
                return;
            }

            if (rounded === targetValue) {
                setScore(prev => prev + 10);
                setActivePopup('correct');
            } else {
                setWrongAnswerData({ expr: cleanExprStr, result: rounded, message: 'Try rearranging the pieces!' });
                setActivePopup('wrongAnswer');
            }
        } catch (e) {
            setWrongAnswerData({ expr: cleanExprStr, result: null, message: 'Cannot evaluate - check syntax.' });
            setActivePopup('wrongAnswer');
        }
    };

    const revealSolution = () => {
        const newEquation = [];
        const newAvailable = availableTokens.map(t => ({ ...t, used: false }));

        originalTokens.forEach(tok => {
            const idx = newAvailable.findIndex(t => !t.used && t.token === tok);
            if (idx >= 0) {
                newAvailable[idx].used = true;
                newEquation.push({ id: newAvailable[idx].id, token: newAvailable[idx].token });
            } else {
                newEquation.push({ id: genId(), token: tok });
            }
        });

        setAvailableTokens(newAvailable);
        setEquationTokens(newEquation);
        setSolutionVisible(true);
    };

    const hintTimerRef = useRef(null);

    // ... (existing code)

    const showHintShort = () => {
        if (!originalExpr) return;

        // Clear existing timer if any
        if (hintTimerRef.current) clearTimeout(hintTimerRef.current);

        const needsParens = originalExpr.includes('(');
        const ops = originalTokens.filter(t => OPS.includes(t));
        const counts = ops.reduce((m, t) => (m[t] = (m[t] || 0) + 1, m), {});
        const firstTok = originalTokens[0];
        const lastTok = originalTokens[originalTokens.length - 1];

        const hints = [];
        if (needsParens) hints.push('Hint: Parentheses are needed.');
        if (ops.length) {
            const firstOp = ops[0];
            const opName = firstOp === '+' ? '+' : firstOp === '-' ? '-' : firstOp === '*' ? '×' : '÷';
            hints.push(`Hint: The first operator is ${opName}.`);
        }
        hints.push(`Hint: Operators — +:${counts['+'] || 0}, -:${counts['-'] || 0}, ×:${counts['*'] || 0}, ÷:${counts['/'] || 0}`);
        if (/[()]/.test(firstTok)) hints.push('Hint: Starts with parenthesis.');
        else hints.push(`Hint: First piece is "${firstTok}".`);
        if (/[()]/.test(lastTok)) hints.push('Hint: Ends with parenthesis.');

        setHint(hints[Math.floor(Math.random() * hints.length)]);

        // Set timer to clear hint after 10 seconds
        hintTimerRef.current = setTimeout(() => {
            setHint(null);
        }, 10000);
    };

    const replayCurrentQuestion = () => {
        if (!currentQuestionRef.current) {
            newRound();
            return;
        }
        const q = currentQuestionRef.current;
        startTimer(getTimerDurationForLevel(currentLevel));
        setOriginalExpr(q.originalExpr);
        setOriginalTokens([...q.originalTokens]);
        setTargetValue(q.targetValue);
        setAvailableTokens(shuffleArray(q.originalTokens.map(t => ({ id: genId(), token: t, used: false }))));
        setEquationTokens([]);
        setSolutionVisible(false);
        setActivePopup(null);
    };

    const nextLevel = () => {
        const next = currentLevel + 1;
        setCurrentLevel(next);
        saveProgress(next);
        setActivePopup(null);
        newRound();
    };

    const startGame = () => {
        setGameStarted(true);
        setActivePopup(null);
        newRound();
    };

    // --- Effects ---
    useEffect(() => {
        loadSavedProgress();
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
            if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
        };
    }, [loadSavedProgress]);

    const allTokensUsed = equationTokens.length === availableTokens.length && equationTokens.length > 0;

    return (
        <>
            {/* Rotate Device Overlay */}
            <div className="rotate-device-overlay">
                <div className="rotate-content">
                    <div className="rotate-icon">📱</div>
                    <h2>Please Rotate Your Device</h2>
                    <p>This game is designed to be played in landscape mode for the best experience.</p>
                </div>
            </div>

            {/* Header Bar */}
            <header className="header-bar">
                <button className="back-btn" onClick={logGameEnd} aria-label="Go back">
                    <i className="fas fa-arrow-left"></i>
                </button>
                <h1>EQUATION BUILDER</h1>
            </header>

            {/* Main Content */}
            {/* Main Content */}
            <main className="main-content">
                {/* Center - Game Card */}
                <div className="game-card" role="application" aria-label="Equation Builder">
                    {/* Target Display */}
                    <div className="target-section">
                        <div className="target-content">
                            <div className="target-label">TARGET NUMBER</div>
                            <div className="target-value">{targetValue ?? '--'}</div>
                        </div>
                        {/* Circular Timer Integration */}
                        <div className="timer-circle">
                            <span className="timer-val">{timeLeft}s</span>
                        </div>
                    </div>

                    {/* Status Row (Moved from Left Panel) */}
                    {/* Status Row (Moved from Left Panel) */}
                    <div className="status-row">
                        <div className="status-item">
                            <span className="status-label">LEVEL</span>
                            <span className="status-value">{currentLevel}</span>
                        </div>
                        <div className="status-item">
                            <span className="status-label">SCORE</span>
                            <span className="status-value">{score}</span>
                        </div>
                    </div>

                    {/* Available Pieces */}
                    <div className="section">
                        <div className="section-label">📦 Available pieces (click to use)</div>
                        <div id="pieces" aria-live="polite">
                            {availableTokens.map((t, i) => (
                                <div
                                    key={t.id}
                                    className={`token ${t.used ? 'used' : ''}`}
                                    onClick={() => !t.used && addToEquation(i)}
                                >
                                    {t.token}
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Equation Building Area */}
                    <div className="section">
                        <div className="section-label">🔧 Build your equation here (use all pieces)</div>
                        <div id="equation" aria-live="polite">
                            {equationTokens.map((t, i) => (
                                <div
                                    key={`${t.id}-${i}`}
                                    className="token"
                                    onClick={() => removeFromEquation(i)}
                                >
                                    {t.token}
                                </div>
                            ))}
                            {equationTokens.length === 0 && (
                                <div className="empty-placeholder">Build your equation here</div>
                            )}
                        </div>
                        {/* Check Solution Button - Always reserve space, show button when all tokens used */}
                        <div className="check-solution-wrapper">
                            {allTokensUsed && !solutionVisible && (
                                <button className="complete-btn" onClick={checkEquation}>
                                    ✅ Check Solution
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Solution Area */}
                    {solutionVisible && (
                        <div className="solution">
                            ✨ Solution: {originalExpr} = {targetValue}
                        </div>
                    )}

                    {/* Hint Display */}
                    {hint && !solutionVisible && (
                        <div className="hint-message">
                            💡 {hint}
                        </div>
                    )}

                    {/* Right Panel - Controls (Moved Inside Game Card for Absolute Positioning) */}
                    <aside className="right-panel">
                        <div className="action-buttons-stack">
                            {gameStarted && (
                                <>
                                    <button className="action-btn primary" onClick={() => newRound()}>
                                        + New Round
                                    </button>
                                    <button className="action-btn" onClick={showHintShort}>
                                        💡 Hint
                                    </button>
                                    <button className="action-btn" onClick={resetEquation}>
                                        🔄 Reset
                                    </button>
                                    <button className="action-btn" onClick={revealSolution}>
                                        ✅ Solution
                                    </button>
                                </>
                            )}
                        </div>
                    </aside>
                </div>
            </main>

            {/* Welcome Popup */}
            {activePopup === 'welcome' && (
                <div className="popup-overlay welcome-popup">
                    <div className="popup-content" role="dialog" aria-modal="true">
                        <button className="popup-close-btn" onClick={logGameEnd} aria-label="Close">×</button>
                        <div className="popup-header">
                            <div className="popup-icon">🧮</div>
                            <h2 className="popup-title">Equation Builder</h2>
                        </div>
                        <div className="popup-message">
                            <p className="welcome-intro">Welcome to the Equation Builder! 🎯</p>

                            <div className="how-to-play">
                                <p><strong>📝 How to Play:</strong></p>
                                <ul>
                                    <li>You'll see a <strong>target number</strong> to reach</li>
                                    <li><strong>Click pieces</strong> (numbers &amp; operators) to build an equation</li>
                                    <li>Use <strong>ALL pieces exactly once</strong></li>
                                    <li>Your equation must equal the target number</li>
                                    <li>Click <strong>Complete</strong> when done to check your answer</li>
                                </ul>
                            </div>

                            <div className="tips-box">
                                <p><strong>💡 Tips:</strong></p>
                                <ul>
                                    <li>Parentheses ( ) mean "do this first"</li>
                                    <li>Use the <strong>Hint</strong> button if you're stuck</li>
                                    <li>Timer runs - but take your time to think!</li>
                                </ul>
                            </div>

                            <p className="ready-text">Ready to solve some puzzles? Let's go! 🚀</p>
                        </div>
                        <div className="popup-buttons">
                            <button className="popup-btn primary" onClick={startGame}>Start Game 🎮</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Time Up Popup */}
            {activePopup === 'timeUp' && (
                <div className="popup-overlay">
                    <div className="popup-content popup-secondary">
                        <div className="popup-icon">⏰</div>
                        <h2 className="popup-title">Time's Up!</h2>
                        <p className="popup-message">The timer has completed. Would you like to try again?</p>
                        <div className="popup-buttons">
                            <button className="popup-btn primary" onClick={replayCurrentQuestion}>🔄 Replay</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Correct Answer Popup */}
            {activePopup === 'correct' && (
                <div className="popup-overlay">
                    <div className="popup-content popup-secondary">
                        <div className="popup-icon">🎉</div>
                        <h2 className="popup-title">Successfully Completed!</h2>
                        <p className="popup-message">Excellent work! Ready for the next challenge?</p>
                        <div className="popup-buttons">
                            <button className="popup-btn primary" onClick={nextLevel}>➡️ Next Level</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Wrong Answer Popup */}
            {activePopup === 'wrongAnswer' && (
                <div className="popup-overlay">
                    <div className="popup-content popup-secondary" role="dialog" aria-modal="true">
                        <div className="popup-icon">🔄</div>
                        <h2 className="popup-title">Try Again!</h2>

                        {/* Expression display */}
                        <div className="expression-box">
                            <span className="expression-label">Your equation</span>
                            <code className="expression-code">{wrongAnswerData.expr || '—'}</code>
                        </div>

                        {/* Result comparison */}
                        <div className="result-comparison">
                            <div className="result-card result-wrong">
                                <span className="result-label">You got</span>
                                <span className="result-value">{wrongAnswerData.result ?? 'N/A'}</span>
                            </div>
                            <div className="result-card result-target">
                                <span className="result-label">Target</span>
                                <span className="result-value">{targetValue}</span>
                            </div>
                        </div>

                        {/* Hint box */}
                        <div className="hint-box">
                            <span className="hint-icon">💡</span>
                            <span className="hint-text">{wrongAnswerData.message}</span>
                        </div>

                        <div className="popup-buttons">
                            <button className="popup-btn primary" onClick={() => setActivePopup(null)}>Try Again</button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default SuperStudent;
