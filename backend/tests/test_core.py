from app.connectors.mock import MockVacancyProvider
from app.db.models import CandidateProfile, SearchProfile
from app.services.core import detect_question, local_filter


def test_question_detector():
    assert detect_question("Как вы использовали Kubernetes?")
    assert not detect_question("Мы использовали Kubernetes.")


def test_mock_has_twenty_vacancies():
    import asyncio

    assert len(asyncio.run(MockVacancyProvider().search())) == 20


def test_local_filter_blacklist_and_salary():
    profile = CandidateProfile(
        blacklisted_companies=["Bad"], blacklisted_keywords=[], minimum_salary=100
    )
    search = SearchProfile(name="x", excluded_keywords=[], salary_min=200, remote=None)
    base = {
        "provider": "mock",
        "external_id": "1",
        "company": "Bad Corp",
        "title": "Dev",
        "description": "",
        "salary_to": 500,
        "remote": True,
    }
    assert local_filter(base, profile, search, set())[1] == "company_blacklist"
    base["company"] = "Good"
    base["salary_to"] = 150
    assert local_filter(base, profile, search, set())[1] == "salary"


def test_deduplication():
    p = CandidateProfile(blacklisted_companies=[], blacklisted_keywords=[])
    item = {
        "provider": "mock",
        "external_id": "1",
        "company": "A",
        "title": "Dev",
        "description": "",
        "salary_to": 1,
        "remote": True,
    }
    assert local_filter(item, p, None, {("mock", "1")}) == (False, "duplicate")
