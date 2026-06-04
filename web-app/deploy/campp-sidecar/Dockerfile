# CAM++ speaker-diarization sidecar for offline interview mode.
# Transcription stays on cloud Paraformer; this service only assigns a speaker id
# per finalized utterance via CAM++ embeddings + online clustering (campp_sidecar.py).
# CPU is sufficient for per-utterance embeddings — no GPU required.
FROM python:3.10

# CPU torch (small + reliable) from the official index; funasr/modelscope from the
# Aliyun mirror (CN-friendly). Matches the manually-validated environment.
RUN pip install --no-cache-dir --timeout 300 --retries 5 \
      torch torchaudio --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir --timeout 300 --retries 5 \
      -i https://mirrors.aliyun.com/pypi/simple funasr modelscope numpy

# Bake the CAM++ model into the image so the container starts ready (no first-request download).
RUN python -c "from funasr import AutoModel; AutoModel(model='iic/speech_campplus_sv_zh-cn_16k-common', disable_pbar=True, disable_log=True)"

COPY campp_sidecar.py /app/campp_sidecar.py
WORKDIR /app
ENV CAMPP_PORT=10097
EXPOSE 10097
CMD ["python", "/app/campp_sidecar.py"]
