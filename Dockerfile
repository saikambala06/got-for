# Container image for running the resume parser with OCR enabled.
#
# Vercel's Python runtime cannot run OCR because it has no `tesseract` binary.
# This image runs the identical pipeline with OCR working, for deploying to
# Render, Railway, Fly.io, Cloud Run or any container host. Point the portal's
# parser calls at it and scanned resumes start working with no code change.

FROM python:3.11-slim

# tesseract is the OCR engine; the language data is a separate package.
RUN apt-get update && apt-get install -y --no-install-recommends \
        tesseract-ocr tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt requirements-ocr.txt ./
RUN pip install --no-cache-dir -r requirements-ocr.txt

COPY api/ ./api/

ENV PYTHONPATH=/app/api
ENV PORT=8080
EXPOSE 8080

CMD ["python", "-m", "_resume_parser.server"]
