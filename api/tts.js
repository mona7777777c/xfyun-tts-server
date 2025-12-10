// 文件路径：/api/tts.js
const CryptoJS = require('crypto-js');

module.exports = async (req, res) => {
  // 1. 设置响应头，允许前端跨域访问
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // 2. 处理浏览器预检请求
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // 3. 只允许POST请求
  if (req.method !== 'POST') {
    res.status(405).json({ error: '只支持POST请求' });
    return;
  }

  // 4. 获取前端发送的文本
  const { text } = req.body;
  if (!text || text.trim() === '') {
    res.status(400).json({ error: '请求中必须包含 text 参数' });
    return;
  }

  // 5. 从环境变量获取你的讯飞密钥（需要在Vercel后台设置）
  const APPID = process.env.XF_APPID;
  const API_KEY = process.env.XF_API_KEY;
  const API_SECRET = process.env.XF_API_SECRET;

  if (!APPID || !API_KEY || !API_SECRET) {
    console.error('错误：请在Vercel中设置环境变量 XF_APPID, XF_API_KEY, XF_API_SECRET');
    res.status(500).json({ error: '服务器配置错误' });
    return;
  }

  // 6. 生成讯飞API所需的鉴权参数（固定代码，无需修改）
  const url = 'wss://tts-api.xfyun.cn/v2/tts';
  const host = 'tts-api.xfyun.cn';
  const date = new Date().toUTCString();
  
  // 生成签名
  const tmp = `host: ${host}\ndate: ${date}\nGET /v2/tts HTTP/1.1`;
  const signatureSha = CryptoJS.HmacSHA256(tmp, API_SECRET);
  const signature = CryptoJS.enc.Base64.stringify(signatureSha);
  
  // 生成授权参数
  const authorizationOrigin = `api_key="${API_KEY}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;
  const authorization = Buffer.from(authorizationOrigin).toString('base64');
  
  // 生成最终WebSocket连接URL
  const finalUrl = `${url}?authorization=${authorization}&date=${encodeURIComponent(date)}&host=${host}`;

  // 7. 准备发送给讯飞的数据
  const businessParams = {
    aue: 'lame',
    sfl: 1,
    auf: 'audio/L16;rate=16000',
    vcn: 'x4_lingxiaojie',
    speed: 50,
    volume: 50,
    pitch: 50,
    bgs: 0,
    tte: 'UTF8',
    reg: '0',
    ram: '0',
    rdn: '0'
  };

  const dataParams = {
    status: 2,
    text: Buffer.from(text).toString('base64')
  };

  const requestData = JSON.stringify({
    common: { app_id: APPID },
    business: businessParams,
    data: dataParams
  });

  // 8. 使用 fetch 和 WebSocket 与讯飞API通信
  try {
    const WebSocket = require('ws');
    const ws = new WebSocket(finalUrl);
    
    const audioBuffers = [];
    let resolveAudio;
    let rejectAudio;
    
    const audioPromise = new Promise((resolve, reject) => {
      resolveAudio = resolve;
      rejectAudio = reject;
    });
    
    const timeout = setTimeout(() => {
      ws.close();
      rejectAudio(new Error('请求超时'));
    }, 10000);
    
    ws.on('open', () => {
      console.log('已连接讯飞TTS服务器');
      ws.send(requestData);
    });
    
    ws.on('message', (data) => {
      const response = JSON.parse(data);
      
      if (response.code !== 0) {
        clearTimeout(timeout);
        ws.close();
        rejectAudio(new Error(`讯飞API错误: ${response.message} (代码: ${response.code})`));
        return;
      }
      
      if (response.data && response.data.audio) {
        const audioData = Buffer.from(response.data.audio, 'base64');
        audioBuffers.push(audioData);
      }
      
      if (response.data && response.data.status === 2) {
        clearTimeout(timeout);
        ws.close();
        
        if (audioBuffers.length === 0) {
          rejectAudio(new Error('未收到音频数据'));
          return;
        }
        
        const finalAudio = Buffer.concat(audioBuffers);
        resolveAudio(finalAudio);
      }
    });
    
    ws.on('error', (error) => {
      clearTimeout(timeout);
      rejectAudio(error);
    });
    
    ws.on('close', () => {
      clearTimeout(timeout);
    });
    
    // 9. 等待音频数据并返回给前端
    const audioBuffer = await audioPromise;
    
    res.setHeader('Content-Type', 'audio/mpeg');
    res.send(audioBuffer);
    
  } catch (error) {
    console.error('TTS处理失败:', error);
    res.status(500).json({ 
      error: '语音合成失败',
      details: error.message 
    });
  }
};
