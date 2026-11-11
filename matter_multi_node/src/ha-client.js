import WebSocket from 'ws';
import { EventEmitter } from 'events';

export class HAClient extends EventEmitter {
  constructor(url, token) {
    super();
    this.url = url;
    this.token = token;
    this.ws = null;
    this.messageId = 1;
    this.pendingRequests = new Map();
    this.reconnectTimer = null;
    this.isConnected = false;
    this.states = new Map(); // entity_id -> state object
  }

  start() {
    this.connect();
  }

  stop() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }

  connect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    console.log(`[HA Client] Connecting to Home Assistant at ${this.url}...`);
    try {
      this.ws = new WebSocket(this.url);
    } catch (err) {
      console.error(`[HA Client] Connection failed:`, err.message);
      this.scheduleReconnect();
      return;
    }

    this.ws.on('open', () => {
      console.log('[HA Client] WebSocket connection opened.');
    });

    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        this.handleMessage(msg);
      } catch (err) {
        console.error('[HA Client] Error parsing incoming message:', err);
      }
    });

    this.ws.on('close', (code, reason) => {
      console.warn(`[HA Client] WebSocket closed (code ${code}): ${reason || 'No reason'}`);
      this.isConnected = false;
      this.emit('disconnected');
      this.scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      console.error('[HA Client] WebSocket error:', err.message);
      // close event will trigger reconnect
    });
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    console.log('[HA Client] Reconnecting in 5 seconds...');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 5000);
  }

  handleMessage(msg) {
    if (msg.type === 'auth_required') {
      console.log('[HA Client] Auth required. Sending token...');
      this.send({
        type: 'auth',
        access_token: this.token,
      });
      return;
    }

    if (msg.type === 'auth_ok') {
      console.log(`[HA Client] Authenticated successfully with HA v${msg.ha_version}!`);
      this.isConnected = true;
      this.emit('connected');
      this.initSubscriptions();
      return;
    }

    if (msg.type === 'auth_invalid') {
      console.error('[HA Client] Authentication failed! Invalid token:', msg.message);
      this.isConnected = false;
      this.emit('auth_failed', msg.message);
      return;
    }

    if (msg.type === 'result') {
      const handler = this.pendingRequests.get(msg.id);
      if (handler) {
        this.pendingRequests.delete(msg.id);
        if (msg.success) {
          handler.resolve(msg.result);
        } else {
          handler.reject(new Error(msg.error ? `${msg.error.code}: ${msg.error.message}` : 'Unknown HA error'));
        }
      }
      return;
    }

    if (msg.type === 'event' && msg.event?.event_type === 'state_changed') {
      const eventData = msg.event.data;
      if (eventData && eventData.entity_id) {
        const entityId = eventData.entity_id;
        const newState = eventData.new_state;
        if (newState) {
          this.states.set(entityId, newState);
          const isOn = newState.state === 'on';
          this.emit('state_changed', {
            entity_id: entityId,
            state: isOn,
            raw_state: newState.state,
            attributes: newState.attributes || {},
          });
        }
      }
      return;
    }
  }

  async initSubscriptions() {
    try {
      // 1. Fetch all states
      const states = await this.sendRequest({ type: 'get_states' });
      for (const s of states) {
        this.states.set(s.entity_id, s);
      }
      console.log(`[HA Client] Loaded ${states.length} entity states from HA.`);
      this.emit('states_loaded', this.states);

      // 2. Subscribe to state changes
      await this.sendRequest({
        type: 'subscribe_events',
        event_type: 'state_changed',
      });
      console.log('[HA Client] Subscribed to state_changed events.');
    } catch (err) {
      console.error('[HA Client] Error during initial setup:', err.message);
    }
  }

  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  sendRequest(obj) {
    return new Promise((resolve, reject) => {
      const id = this.messageId++;
      const payload = { ...obj, id };
      this.pendingRequests.set(id, { resolve, reject });
      this.send(payload);

      // Timeout request after 10s
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`HA Request ${id} (${obj.type}) timed out`));
        }
      }, 10000);
    });
  }

  async setEntityState(entityId, turnOn) {
    const domain = entityId.split('.')[0];
    const service = turnOn ? 'turn_on' : 'turn_off';

    console.log(`[HA Client] Calling service ${domain}.${service} for ${entityId}`);
    try {
      await this.sendRequest({
        type: 'call_service',
        domain: domain,
        service: service,
        target: {
          entity_id: entityId,
        },
      });
      return true;
    } catch (err) {
      console.error(`[HA Client] Failed to call ${domain}.${service} on ${entityId}:`, err.message);
      return false;
    }
  }

  getState(entityId) {
    return this.states.get(entityId);
  }
}
