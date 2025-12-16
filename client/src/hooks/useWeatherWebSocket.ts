import { useEffect, useRef, useCallback, useState } from "react";
import type { WeatherData } from "@shared/schema";

type WebSocketStatus = "connecting" | "connected" | "disconnected" | "error";

interface UseWeatherWebSocketOptions {
  stationId: number | null;
  onUpdate?: (data: WeatherData) => void;
}

export function useWeatherWebSocket({ stationId, onUpdate }: UseWeatherWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<WebSocketStatus>("disconnected");
  const [latestData, setLatestData] = useState<WeatherData | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    setStatus("connecting");
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      setStatus("connected");
      if (stationId !== null) {
        ws.send(JSON.stringify({ type: "subscribe", stationId }));
      }
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        
        if (message.type === "weather_update" && message.stationId === stationId) {
          setLatestData(message.data);
          onUpdate?.(message.data);
        }
      } catch (error) {
        console.error("WebSocket message parse error:", error);
      }
    };

    ws.onerror = () => {
      setStatus("error");
    };

    ws.onclose = () => {
      setStatus("disconnected");
      wsRef.current = null;
      
      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, 5000);
    };

    wsRef.current = ws;
  }, [stationId, onUpdate]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    
    setStatus("disconnected");
  }, []);

  const subscribe = useCallback((newStationId: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "subscribe", stationId: newStationId }));
    }
  }, []);

  const unsubscribe = useCallback((targetStationId: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "unsubscribe", stationId: targetStationId }));
    }
  }, []);

  useEffect(() => {
    connect();

    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  useEffect(() => {
    if (stationId !== null && wsRef.current?.readyState === WebSocket.OPEN) {
      subscribe(stationId);
    }
  }, [stationId, subscribe]);

  return {
    status,
    latestData,
    subscribe,
    unsubscribe,
    disconnect,
    reconnect: connect,
  };
}
