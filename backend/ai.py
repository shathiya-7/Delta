import os
import json
import logging
import urllib.request
import urllib.error
from pathlib import Path

logger = logging.getLogger(__name__)

def get_gemini_api_key() -> str:
    """Retrieves GEMINI_API_KEY from environment or .env file."""
    key = os.environ.get('GEMINI_API_KEY', '').strip()
    if key:
        return key

    root_dir = Path(__file__).resolve().parent.parent
    env_file = root_dir / '.env'
    if env_file.exists():
        try:
            for line in env_file.read_text(encoding='utf-8').splitlines():
                line = line.strip()
                if line.startswith('GEMINI_API_KEY='):
                    val = line.split('=', 1)[1].strip().strip('"').strip("'")
                    if val:
                        os.environ['GEMINI_API_KEY'] = val
                        return val
        except Exception as exc:
            logger.warning("Failed to parse .env for GEMINI_API_KEY: %s", exc)
    return ''

def generate_ai_analysis(curriculum_data: dict, role_name: str) -> dict:
    """
    Calls Gemini API to generate real-time AI curriculum insights and project recommendations.
    Fails safely without raising exceptions to protect the core analysis pipeline.
    """
    api_key = get_gemini_api_key()
    if not api_key:
        return {
            'status': 'disabled',
            'message': 'Add GEMINI_API_KEY to your .env file to activate live AI curriculum critique.'
        }

    pages = curriculum_data.get('pages', [])
    syllabus_sample = "\n".join(p.get('text', '')[:600] for p in pages[:8])
    if len(syllabus_sample) > 3500:
        syllabus_sample = syllabus_sample[:3500]

    detected_skills = [
        s.get('skill')
        for s in curriculum_data.get('skills', [])
        if isinstance(s, dict) and s.get('skill')
    ]
    detected_str = ", ".join(detected_skills[:12]) if detected_skills else "None explicitly detected"

    outcomes = [
        co.get('statement')
        for co in curriculum_data.get('course_outcomes', [])
        if isinstance(co, dict) and co.get('statement')
    ]
    outcomes_str = "; ".join(outcomes[:4]) if outcomes else "Foundational technical coursework"

    prompt = f"""You are an elite software engineering director and technical curriculum auditor.
Analyze this university syllabus against live industry hiring demand for a '{role_name}' role.

DETECTED SKILLS IN SYLLABUS:
{detected_str}

COURSE OUTCOMES:
{outcomes_str}

SYLLABUS EXCERPTS:
\"\"\"{syllabus_sample}\"\"\"

Generate an insightful, concise evaluation formatted strictly as JSON with this schema:
{{
  "verdict_title": "A sharp 3-6 word summary (e.g. Strong Fundamentals, Missing Cloud Deployment)",
  "executive_critique": "2 to 3 sentences objectively critiquing how well the syllabus aligns with modern hiring expectations.",
  "modernity_score": 75,
  "top_missing_skills": [
    {{"skill": "Skill name", "why_it_matters": "One clear sentence on why entry-level {role_name} roles demand it."}},
    {{"skill": "Skill name", "why_it_matters": "One clear sentence on why entry-level {role_name} roles demand it."}},
    {{"skill": "Skill name", "why_it_matters": "One clear sentence on why entry-level {role_name} roles demand it."}}
  ],
  "recommended_project": "A specific hands-on project the student should build to prove competency.",
  "quick_40min_lab": "A targeted 40-minute lab task title and steps to patch the biggest syllabus gap."
}}
"""

    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "temperature": 0.2,
            "maxOutputTokens": 800,
            "thinkingConfig": {
                "thinkingBudget": 0
            }
        }
    }
    encoded_data = json.dumps(payload).encode('utf-8')

    # Prioritize gemini-3-flash-preview with zero thinking budget for instant 3s response
    models_to_try = ["gemini-3-flash-preview", "gemini-3.5-flash", "gemini-3.1-flash-lite"]

    for model in models_to_try:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
        req = urllib.request.Request(url, data=encoded_data, headers={"Content-Type": "application/json"})
        
        # Try up to 2 attempts per model to handle transient 503 Service Unavailable spikes
        for attempt in range(2):
            try:
                with urllib.request.urlopen(req, timeout=25) as resp:
                    res = json.loads(resp.read().decode('utf-8'))
                    raw_text = res["candidates"][0]["content"]["parts"][0]["text"].strip()
                    parsed = json.loads(raw_text)
                    return {
                        'status': 'ready',
                        'model': model,
                        'data': parsed
                    }
            except Exception as exc:
                err_str = str(exc)
                logger.warning("Gemini model %s (attempt %d/2) failed: %s", model, attempt + 1, err_str)
                if '503' in err_str or '429' in err_str or 'timed out' in err_str.lower():
                    import time
                    time.sleep(1.0)
                    continue
                break

    return {
        'status': 'unavailable',
        'message': 'AI insights could not be retrieved at this time. Standard market demand analysis completed successfully.'
    }
