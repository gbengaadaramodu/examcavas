import React, { useState, useEffect, useCallback } from 'react';

// Defined outside component to prevent recreation on every render cycle
const DEMO_SUBMISSIONS = [
  {
    id: 101,
    examId: 1,
    exam: { title: "Introduction to Quantum Physics (Theoretical)", totalMarks: 20 },
    studentId: 999,
    student: { name: "Sarah Connor", email: "sconnor@academy.edu" },
    rawStrokeJson: JSON.stringify([
      [
        { canvasX: 50, canvasY: 80, pressure: 0.6, timestamp: 1 },
        { canvasX: 120, canvasY: 75, pressure: 0.8, timestamp: 2 },
        { canvasX: 200, canvasY: 90, pressure: 0.5, timestamp: 3 }
      ],
      [
        { canvasX: 90, canvasY: 120, pressure: 0.7, timestamp: 4 },
        { canvasX: 180, canvasY: 130, pressure: 0.9, timestamp: 5 }
      ]
    ]),
    translatedText: "E = mc^2 is the mass-energy equivalence. Planck constant is relevant for photon energy mapping.",
    aiGradingLog: "# Grading Report\n\n## Criterion 1: Equation Formulation\n- Student correctly identified relativity principles (5/5).\n\n## Criterion 2: Calculation Flow\n- Error made in early constant resolution, carried forward correctly (4/5).\n\n## Final Suggestion:\nResponse matches required physical constraints.",
    approvedScore: 17.5,
    isApproved: false
  },
  {
    id: 102,
    examId: 2,
    exam: { title: "Algorithms & Complexities - Midterm", totalMarks: 10 },
    studentId: 998,
    student: { name: "John Doe", email: "jdoe@academy.edu" },
    rawStrokeJson: "",
    translatedText: "Bubble sort average case runtime complexity is O(N^2) due to nested loops comparison.",
    aiGradingLog: "# Grading Report\n\n## Criterion 1: Algorithm Complexity Identification\n- Correct analysis of runtime loops (5/5).\n\n## Criterion 2: Best/Worst Case Bounds\n- Omitted best case optimization comments (-2 marks).\n\n## Final Suggestion:\nReasonable core comprehension.",
    approvedScore: 8.0,
    isApproved: false
  }
];

/**
 * InstructorVerificationPanel component for Human-in-the-Loop AI grading validation.
 * Features:
 * - List of pending exam submissions.
 * - Split column screen layout (Left: Vector Stroke Rendering, Right: Editable AI Feedback).
 * - Interactive score override controls.
 * - Administrative validation to finalize and approve scores.
 */
export default function InstructorVerificationPanel({ apiBaseUrl = 'http://localhost:5081' }) {
  const [submissions, setSubmissions] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  // Editable fields for human override
  const [editedScore, setEditedScore] = useState('');
  const [editedFeedback, setEditedFeedback] = useState('');

  // Load submissions from API or use demo fallback
  useEffect(() => {
    fetchSubmissions();
  }, [fetchSubmissions]);

  const fetchSubmissions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/submissions`);
      if (res.ok) {
        const data = await res.json();
        const list = data.length > 0 ? data : DEMO_SUBMISSIONS;
        setSubmissions(list);
        selectSubmission(list[0]);
      } else {
        throw new Error("API responded with error");
      }
    } catch (err) {
      console.warn("Backend API offline. Operating in simulation mode with mock DB data.");
      setSubmissions(DEMO_SUBMISSIONS);
      selectSubmission(DEMO_SUBMISSIONS[0]);
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl]);

  const selectSubmission = (sub) => {
    setSelectedId(sub.id);
    setEditedScore(sub.approvedScore.toString());
    setEditedFeedback(sub.aiGradingLog);
  };

  const currentSubmission = submissions.find(s => s.id === selectedId) || null;

  // Render vector paths inside a mock canvas container
  const renderCanvasStrokeVector = (rawJson) => {
    if (!rawJson) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-slate-500 p-8 border-2 border-dashed border-slate-700 rounded-xl bg-slate-900/50">
          <svg className="w-12 h-12 mb-3 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
          <span className="text-sm font-medium">No handwritten stroke telemetry available</span>
          <span className="text-xs text-slate-600 mt-1">Submission was transcribed via text fallback</span>
        </div>
      );
    }

    try {
      const strokes = JSON.parse(rawJson);
      return (
        <div className="relative w-full h-full min-h-[350px] bg-[#0b0f19] border border-slate-800 rounded-xl p-4 flex flex-col justify-between overflow-hidden">
          {/* Simulated Grid lines to represent student test sheets */}
          <div className="absolute inset-0 pointer-events-none opacity-5" style={{ 
            backgroundImage: 'radial-gradient(circle, #6366f1 1px, transparent 1px)', 
            backgroundSize: '24px 24px' 
          }}></div>
          
          <div className="relative z-10 flex justify-between items-center text-xs text-slate-500 mb-2">
            <span>STUDENT CANVAS TELEMETRY (SCALED VECTORS)</span>
            <span className="bg-indigo-900/30 text-indigo-400 px-2 py-0.5 rounded border border-indigo-500/20 font-mono">
              Strokes: {strokes.length}
            </span>
          </div>

          <div className="relative flex-1 w-full min-h-[300px]">
            <svg viewBox="0 0 800 500" className="w-full h-full max-h-[450px]">
              {strokes.map((stroke, strokeIdx) => {
                if (stroke.length === 0) return null;
                // Generate SVG path string from point coordinates
                const pathData = stroke.reduce((acc, pt, ptIdx) => {
                  const cmd = ptIdx === 0 ? 'M' : 'L';
                  return `${acc} ${cmd} ${pt.canvasX * 1.5} ${pt.canvasY * 1.5}`;
                }, '');
                return (
                  <path
                    key={strokeIdx}
                    d={pathData}
                    fill="none"
                    stroke="#818cf8"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={0.9}
                  />
                );
              })}
            </svg>
          </div>

          <div className="relative z-10 bg-slate-900/80 backdrop-filter blur border-t border-slate-800 p-3 rounded-lg mt-2">
            <span className="block text-xs font-semibold text-slate-400 mb-1">OCR TRANSLATED TRANSCRIPT:</span>
            <p className="text-sm italic text-slate-300">"{currentSubmission?.translatedText}"</p>
          </div>
        </div>
      );
    } catch (e) {
      return <div className="text-red-400 text-xs">Error parsing stroke log telemetry: {e.message}</div>;
    }
  };

  const handleApprove = async () => {
    if (!currentSubmission) return;
    setSaving(true);
    
    const parsedScore = parseFloat(editedScore);
    if (isNaN(parsedScore) || parsedScore < 0 || parsedScore > currentSubmission.exam.totalMarks) {
      triggerToast(`Please input a valid score between 0 and ${currentSubmission.exam.totalMarks}`, 'error');
      setSaving(false);
      return;
    }

    try {
      const res = await fetch(`${apiBaseUrl}/api/submissions/${currentSubmission.id}/approve`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvedScore: parsedScore })
      });

      if (res.ok) {
        triggerToast("Grade finalized and approved successfully!");
        // Update local status state
        setSubmissions(prev => prev.map(s => s.id === currentSubmission.id ? { ...s, approvedScore: parsedScore, aiGradingLog: editedFeedback, isApproved: true } : s));
      } else {
        throw new Error("PATCH response failed");
      }
    } catch (err) {
      console.warn("Offline fallback: Simulated successful approval state change locally.");
      triggerToast("Grade updated locally (simulation)!");
      setSubmissions(prev => prev.map(s => s.id === currentSubmission.id ? { ...s, approvedScore: parsedScore, aiGradingLog: editedFeedback, isApproved: true } : s));
    } finally {
      setSaving(false);
    }
  };

  const triggerToast = (msg, type = 'success') => {
    setToast({ text: msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans antialiased">
      {/* Toast Alert */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-xl font-medium transition-all transform duration-300 ${
          toast.type === 'error' ? 'bg-rose-600 text-white' : 'bg-emerald-600 text-white'
        }`}>
          {toast.text}
        </div>
      )}

      {/* Admin Navbar */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur-md px-6 py-4 flex justify-between items-center sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600 text-white px-2.5 py-1.5 rounded-lg font-bold text-sm tracking-wider">SK</div>
          <div>
            <h1 className="text-base font-semibold leading-tight">Instructor Validation Panel</h1>
            <p className="text-xs text-slate-400">Theoretical Exam Grading - Human-in-the-Loop Agent Verification</p>
          </div>
        </div>
        <button 
          onClick={fetchSubmissions}
          className="text-xs border border-slate-800 bg-slate-900 hover:bg-slate-800 text-slate-300 font-medium py-1.5 px-3 rounded-md transition"
        >
          Sync API Submissions
        </button>
      </header>

      {/* Split Layout Body */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-4 gap-6 p-6 overflow-hidden">
        {/* Left Side Submissions Sidebar Queue */}
        <div className="lg:col-span-1 border border-slate-800 bg-slate-900/30 rounded-2xl p-4 flex flex-col gap-4 max-h-[calc(100vh-140px)] overflow-y-auto">
          <h2 className="text-xs font-semibold text-slate-400 tracking-wider">PENDING QUEUE ({submissions.filter(s => !s.isApproved).length})</h2>
          
          {loading ? (
            <div className="text-center py-6 text-sm text-slate-500">Loading submissions...</div>
          ) : (
            <div className="flex flex-col gap-2">
              {submissions.map((sub) => (
                <div
                  key={sub.id}
                  onClick={() => selectSubmission(sub)}
                  className={`p-3.5 rounded-xl cursor-pointer border transition ${
                    selectedId === sub.id
                      ? 'border-indigo-500 bg-indigo-950/20 text-white'
                      : 'border-slate-800/80 bg-slate-900/40 hover:bg-slate-900 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <div className="flex justify-between items-start mb-1.5">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Sub #{sub.id}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase ${
                      sub.isApproved ? 'bg-emerald-950 text-emerald-400 border border-emerald-900' : 'bg-amber-950 text-amber-400 border border-amber-900'
                    }`}>
                      {sub.isApproved ? 'Verified' : 'Pending'}
                    </span>
                  </div>
                  <h3 className="text-sm font-semibold truncate text-slate-200">{sub.student.name}</h3>
                  <p className="text-xs text-slate-500 truncate mt-0.5">{sub.exam.title}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Dynamic Verification Space */}
        {currentSubmission ? (
          <div className="lg:col-span-3 grid grid-cols-1 md:grid-cols-2 gap-6 max-h-[calc(100vh-140px)] overflow-y-auto">
            {/* Left Column: Student Canvas Telemetry */}
            <div className="flex flex-col gap-4 border border-slate-800 bg-slate-900/20 rounded-2xl p-5">
              <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-indigo-400"></span> Student Handwriting
              </h2>
              <div className="flex-1 min-h-[350px]">
                {renderCanvasStrokeVector(currentSubmission.rawStrokeJson)}
              </div>
            </div>

            {/* Right Column: AI Feedback Editor & Overrides */}
            <div className="flex flex-col gap-4 border border-slate-800 bg-slate-900/20 rounded-2xl p-5 justify-between">
              <div className="flex flex-col gap-4">
                <div className="flex justify-between items-start">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-purple-400"></span> AI Feedback Assessment Report
                    </h2>
                    <span className="text-[10px] text-slate-500 block mt-0.5">Editable grading template generated by agent</span>
                  </div>
                  
                  {/* Score Indicator Box */}
                  <div className="bg-slate-900/80 border border-slate-800 px-3 py-1.5 rounded-lg text-right">
                    <span className="block text-[10px] font-semibold text-slate-500">SUGGESTED SCORE</span>
                    <span className="text-base font-bold text-indigo-400">{currentSubmission.approvedScore} <span className="text-xs text-slate-500">/ {currentSubmission.exam.totalMarks}</span></span>
                  </div>
                </div>

                {/* Editable Report Text Area */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-400 uppercase">Grading Markdowns</label>
                  <textarea
                    value={editedFeedback}
                    onChange={(e) => setEditedFeedback(e.target.value)}
                    className="w-full min-h-[220px] max-h-[300px] p-3 text-sm font-mono bg-slate-950 border border-slate-800 rounded-xl focus:border-indigo-500 focus:outline-none text-slate-300"
                    placeholder="AI Grading report markdown template..."
                  />
                </div>

                {/* Score Override Row */}
                <div className="flex gap-4 items-center bg-slate-900/40 p-4 border border-slate-800/80 rounded-xl">
                  <div className="flex-1">
                    <label className="block text-xs font-semibold text-slate-400 uppercase mb-1">Human Instructor Score Override</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        step="0.25"
                        min="0"
                        max={currentSubmission.exam.totalMarks}
                        value={editedScore}
                        onChange={(e) => setEditedScore(e.target.value)}
                        className="w-24 px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-center font-bold text-indigo-400 focus:outline-none focus:border-indigo-500"
                      />
                      <span className="text-sm font-medium text-slate-500">/ {currentSubmission.exam.totalMarks} Total Marks</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Administrative validation */}
              <div className="mt-4 pt-4 border-t border-slate-800/80 flex justify-end gap-3">
                <button
                  onClick={() => selectSubmission(currentSubmission)}
                  disabled={saving}
                  className="px-4 py-2 text-xs font-medium border border-slate-800 hover:bg-slate-900 rounded-lg transition"
                >
                  Reset Changes
                </button>
                <button
                  onClick={handleApprove}
                  disabled={saving}
                  className="px-5 py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition shadow-lg shadow-indigo-600/10 disabled:opacity-50"
                >
                  {saving ? 'Approving...' : 'Verify & Approve Score'}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="lg:col-span-3 border border-slate-800 bg-slate-900/10 rounded-2xl flex flex-col justify-center items-center p-8">
            <span className="text-sm text-slate-500">Please select a submission from the pending queue.</span>
          </div>
        )}
      </main>
    </div>
  );
}
