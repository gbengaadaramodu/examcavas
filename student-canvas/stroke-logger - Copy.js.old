/**
 * StrokeLogger: High-performance canvas vector stroke capture telemetry class.
 * Captures coordinates, pressure, and timestamps of pointer/stylus inputs, 
 * with robust local persistence fallback using IndexedDB for network resilience.
 */
export class StrokeLogger {
  constructor(canvasElement, options = {}) {
    if (!canvasElement) {
      throw new Error("Canvas element is required for StrokeLogger initialization.");
    }
    this.canvas = canvasElement;
    this.options = {
      onStrokeStart: null,
      onStrokeMove: null,
      onStrokeEnd: null,
      dbName: "StudentCanvasCache",
      dbVersion: 1,
      storeName: "pending_submissions",
      ...options
    };

    this.isDrawing = false;
    this.strokes = []; // Array of arrays: [ { x, y, pressure, timestamp }, ... ]
    this.currentStroke = null;
    this.db = null;

    // Fire-and-forget but catch to prevent unhandled promise rejection
    this.initDatabase().catch((err) =>
      console.error("StrokeLogger: IndexedDB could not be initialized.", err)
    );
    this.bindEvents();
  }

  /**
   * Initializes IndexedDB database for offline backup.
   */
  async initDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.options.dbName, this.options.dbVersion);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this.options.storeName)) {
          db.createObjectStore(this.options.storeName, { keyPath: "id", autoIncrement: true });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        console.log("IndexedDB Initialized successfully for StrokeLogger.");
        resolve(this.db);
      };

      request.onerror = (event) => {
        console.error("IndexedDB initialization error:", event.target.error);
        reject(event.target.error);
      };
    });
  }

  /**
   * Binds pointer event listeners to capture high-fidelity drawing interactions.
   */
  bindEvents() {
    this.canvas.addEventListener("pointerdown", this.handlePointerDown.bind(this));
    this.canvas.addEventListener("pointermove", this.handlePointerMove.bind(this));
    this.canvas.addEventListener("pointerup", this.handlePointerUp.bind(this));
    this.canvas.addEventListener("pointercancel", this.handlePointerUp.bind(this));
    
    // Prevent default touch scrolling inside canvas boundary
    this.canvas.style.touchAction = "none";
  }

  handlePointerDown(event) {
    this.canvas.setPointerCapture(event.pointerId);
    this.isDrawing = true;
    this.currentStroke = [];
    
    const point = this.extractTelemetry(event);
    this.currentStroke.push(point);

    if (typeof this.options.onStrokeStart === "function") {
      this.options.onStrokeStart(point, event);
    }
  }

  handlePointerMove(event) {
    if (!this.isDrawing || !this.currentStroke) return;

    // Support coalesced events for sub-frame resolution if supported by the browser
    if (event.getCoalescedEvents) {
      const coalescedEvents = event.getCoalescedEvents();
      for (const coalescedEvent of coalescedEvents) {
        const point = this.extractTelemetry(coalescedEvent);
        this.currentStroke.push(point);
        if (typeof this.options.onStrokeMove === "function") {
          this.options.onStrokeMove(point, coalescedEvent);
        }
      }
    } else {
      const point = this.extractTelemetry(event);
      this.currentStroke.push(point);
      if (typeof this.options.onStrokeMove === "function") {
        this.options.onStrokeMove(point, event);
      }
    }
  }

  handlePointerUp(event) {
    if (!this.isDrawing) return;
    this.isDrawing = false;

    if (this.currentStroke && this.currentStroke.length > 0) {
      const point = this.extractTelemetry(event);
      this.currentStroke.push(point);
      this.strokes.push(this.currentStroke);

      if (typeof this.options.onStrokeEnd === "function") {
        this.options.onStrokeEnd(this.currentStroke, event);
      }
    }
    
    this.currentStroke = null;
    try {
      this.canvas.releasePointerCapture(event.pointerId);
    } catch (e) {
      // Ignore if pointer capture release is not supported or already released
    }
  }

  /**
   * Extracts telemetry coordinates, pressure, and timestamp from a pointer event.
   *
   * Coordinate system: canvasX/Y are in CSS pixels — the same space as
   * pointer clientX/Y and getBoundingClientRect(). The ctx.setTransform(dpr,…)
   * applied in resizeCanvas() handles the CSS→physical-pixel mapping, so NO
   * DPR multiplication or any other scale correction is needed here.
   *
   * Simple rule: canvasX = clientX − rect.left, full stop.
   * Any extra division (scaleX/scaleY) introduces sub-pixel distortion.
   */
  extractTelemetry(event) {
    const rect = this.canvas.getBoundingClientRect();

    const canvasX = event.clientX - rect.left;
    const canvasY = event.clientY - rect.top;

    // event.timeStamp is a DOMHighResTimeStamp (sub-millisecond precision).
    // Pressure: devices without stylus support always return 0, never undefined,
    // so guard against both to fall back to a neutral 0.5 default.
    return {
      clientX:   parseFloat(event.clientX.toFixed(2)),
      clientY:   parseFloat(event.clientY.toFixed(2)),
      canvasX:   parseFloat(canvasX.toFixed(2)),
      canvasY:   parseFloat(canvasY.toFixed(2)),
      pressure:  (event.pressure !== undefined && event.pressure > 0)
                   ? parseFloat(event.pressure.toFixed(4))
                   : 0.5,
      timestamp: event.timeStamp ?? Date.now()
    };
  }

  /**
   * Resets the active memory of captured strokes.
   */
  clear() {
    this.strokes = [];
    this.currentStroke = null;
  }

  /**
   * Returns captured data structured into a clean JSON telemetry array.
   */
  getJSONPayload() {
    return JSON.stringify(this.strokes, null, 2);
  }

  /**
   * Offline persistence caching logic using IndexedDB standard store.
   * Saves the current payload with a unique ID for later synchronization.
   */
  async cachePayloadOffline(examId, studentId) {
    if (!this.db) {
      console.warn("IndexedDB not ready. Attempting re-initialization...");
      await this.initDatabase();
    }

    const payload = {
      examId,
      studentId,
      strokes: this.strokes,
      timestamp: Date.now(),
      synced: false
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.options.storeName], "readwrite");
      const store = transaction.objectStore(this.options.storeName);
      const request = store.add(payload);

      request.onsuccess = () => {
        console.log("Canvas telemetry successfully saved to offline IndexedDB storage.");
        resolve(true);
      };

      request.onerror = (event) => {
        console.error("IndexedDB offline cache failure:", event.target.error);
        reject(event.target.error);
      };
    });
  }

  /**
   * Retrieve all cached local records queued for upload sync.
   */
  async getQueuedPayloads() {
    if (!this.db) await this.initDatabase();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.options.storeName], "readonly");
      const store = transaction.objectStore(this.options.storeName);
      const request = store.getAll();

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }
}
