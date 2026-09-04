# Nano-climate forecast service.
#
# Slim base and no build toolchain: every dependency is a pure-Python wheel
# because the forecast engine deliberately avoids numpy and friends.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# Uploaded data and the SQLite file live on a volume, not in the image, so a
# rebuild never destroys a station's record.
RUN mkdir -p /app/data && \
    adduser --system --group --no-create-home stratus && \
    chown -R stratus:stratus /app
USER stratus

ENV FORECAST_DB=/app/data/forecast.db \
    FORECAST_CACHE_DIR=/app/data/nwp-cache

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD python -c "import urllib.request,sys; \
sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/healthz', \
timeout=4).status == 200 else 1)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", \
     "--proxy-headers", "--forwarded-allow-ips", "*"]
