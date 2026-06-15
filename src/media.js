const { OpenAI } = require("openai");
const axios = require("axios");
const { getSettings } = require("./settings");
const ai = require("./ai");

async function generateImagePrompt(userId, tweetText) {
  const userPrompt = `Aşağıdaki sosyal medya gönderisi için İngilizce, yüksek kaliteli bir DALL-E 3 görsel üretim (image generation) promptu yaz. 
Gönderi metni: "${tweetText}"

KURALLAR:
1. Görsel fotogerçekçi, sinematik, modern ve yüksek çözünürlüklü olmalı. 
2. Gönderinin vermek istediği ana fikri veya duyguyu yansıtmalı.
3. İçinde SIFIR YAZI/METİN bulunmalı (metin içermemeli).
4. Prompt tamamen İngilizce olmalı.
5. Sadece promptu düz metin olarak ver, hiçbir açıklama veya tırnak ekleme.`;

  return await ai.chat(userId, "You are an expert prompt engineer for DALL-E 3.", userPrompt);
}

async function generateImage(userId, prompt) {
  const config = getSettings(userId);
  if (!config.openAiApiKey) {
    throw new Error("Görsel üretimi için OpenAI API Anahtarı eksik.");
  }
  
  const openai = new OpenAI({ apiKey: config.openAiApiKey });
  const response = await openai.images.generate({
    model: "dall-e-3",
    prompt: prompt,
    n: 1,
    size: "1024x1024",
    response_format: "url",
  });
  
  const url = response.data[0].url;
  if (!url) throw new Error("OpenAI görsel URL döndürmedi.");
  
  return url;
}

// İlerisi için taslak Luma/Fal.ai Video entegrasyonu.
async function generateVideo(userId, prompt) {
  const config = getSettings(userId);
  if (!config.falApiKey) {
    throw new Error("Video üretimi için Fal.ai / Replicate Anahtarı eksik.");
  }
  throw new Error("Video üretimi henüz implemente edilmedi.");
}

async function downloadMediaBuffer(url) {
  const response = await axios.get(url, { responseType: 'arraybuffer' });
  const buffer = Buffer.from(response.data, "binary");
  let mimeType = response.headers['content-type'];
  if (!mimeType) {
    mimeType = url.includes('.mp4') ? 'video/mp4' : 'image/jpeg';
  }
  return { buffer, mimeType };
}

module.exports = {
  generateImagePrompt,
  generateImage,
  generateVideo,
  downloadMediaBuffer
};
