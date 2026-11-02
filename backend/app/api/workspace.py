"""Per-user study workspace: courses, sections, chat, notes and in-class questions.

The browser keeps a nested course → section document and syncs changes here:
PUT a course (its fields + ordered section ids), PUT each changed section in
full, DELETE removed courses. Everything is scoped to the signed-in user.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.models import (
    ClassQuestion,
    StudyBranch,
    StudyCourse,
    StudyMaterial,
    StudyMessage,
    StudySection,
    User,
)
from app.schemas import (
    WorkspaceBranch,
    WorkspaceClassQuestion,
    WorkspaceCourse,
    WorkspaceCoursePut,
    WorkspaceMaterial,
    WorkspaceMessage,
    WorkspaceRead,
    WorkspaceSection,
    WorkspaceSectionPut,
)
from app.security import get_current_user

router = APIRouter(prefix="/workspace", tags=["workspace"])


def _find_course(db: Session, user: User, client_id: str) -> StudyCourse | None:
    return db.scalar(
        select(StudyCourse).where(StudyCourse.user_id == user.id, StudyCourse.client_id == client_id)
    )


def _section_out(section: StudySection) -> WorkspaceSection:
    return WorkspaceSection(
        id=section.client_id,
        title=section.title,
        created_at=section.created_ms,
        status=section.status,
        materials=[
            WorkspaceMaterial(
                id=item.client_id,
                name=item.name,
                meta=item.meta,
                type=item.file_type,
                status=item.status,
                progress=item.progress,
                error=item.error,
                preview_url=item.preview_url,
                pages=item.pages,
            )
            for item in section.materials
        ],
        analysis=section.analysis,
        analysis_job_id=section.analysis_job_id,
        knowledge_map=section.knowledge_map,
        processing_job=section.processing_job,
        exploration_nodes=[
            WorkspaceBranch(id=item.client_id, title=item.title, parent_id=item.parent_id, question=item.question)
            for item in section.branches
        ],
        chat_history=[
            WorkspaceMessage(id=item.client_id, role=item.role, content=item.content, node_id=item.node_id)
            for item in section.messages
        ],
        mastery=section.mastery,
        class_questions=[
            WorkspaceClassQuestion(
                id=item.client_id,
                question=item.question,
                answer=item.answer,
                topic=item.topic,
                status=item.status,
                asked_at=item.asked_ms,
                answered_at=item.answered_ms,
            )
            for item in section.class_questions
        ],
        live_started_at=section.live_started_ms,
        live_ended_at=section.live_ended_ms,
        live_topic=section.live_topic,
    )


@router.get("", response_model=WorkspaceRead, response_model_exclude_none=True)
def read_workspace(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> WorkspaceRead:
    courses = db.scalars(
        select(StudyCourse)
        .where(StudyCourse.user_id == user.id)
        .order_by(StudyCourse.position, StudyCourse.created_at)
        .options(
            selectinload(StudyCourse.sections).selectinload(StudySection.materials),
            selectinload(StudyCourse.sections).selectinload(StudySection.messages),
            selectinload(StudyCourse.sections).selectinload(StudySection.branches),
            selectinload(StudyCourse.sections).selectinload(StudySection.class_questions),
        )
    ).all()
    return WorkspaceRead(
        courses=[
            WorkspaceCourse(
                id=course.client_id,
                title=course.title,
                code=course.code,
                description=course.description,
                tags=course.tags or [],
                mastery=course.mastery,
                updated=course.updated_label,
                accent=course.accent,
                sections=[_section_out(section) for section in course.sections],
            )
            for course in courses
        ]
    )


@router.put("/course", status_code=status.HTTP_204_NO_CONTENT)
def put_course(
    payload: WorkspaceCoursePut,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    course = _find_course(db, user, payload.id)
    if course is None:
        course = StudyCourse(user_id=user.id, client_id=payload.id)
        db.add(course)
    course.position = payload.position
    course.title = payload.title
    course.code = payload.code
    course.description = payload.description
    course.tags = payload.tags
    course.mastery = payload.mastery
    course.updated_label = payload.updated
    course.accent = payload.accent
    # Sections not in the list were deleted in the browser; the rest take its order.
    order = {section_id: index for index, section_id in enumerate(payload.section_ids)}
    for section in list(course.sections):
        if section.client_id in order:
            section.position = order[section.client_id]
        else:
            course.sections.remove(section)
    db.commit()


@router.delete("/course", status_code=status.HTTP_204_NO_CONTENT)
def delete_course(
    id: str = Query(min_length=1, max_length=200),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    course = _find_course(db, user, id)
    if course is not None:
        db.delete(course)
        db.commit()


@router.put("/section", status_code=status.HTTP_204_NO_CONTENT)
def put_section(
    payload: WorkspaceSectionPut,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    course = _find_course(db, user, payload.course_id)
    if course is None:
        raise HTTPException(status_code=404, detail="课程不存在，请先保存课程")
    data = payload.section
    section = db.scalar(
        select(StudySection).where(StudySection.course_id == course.id, StudySection.client_id == data.id)
    )
    if section is None:
        section = StudySection(client_id=data.id)
        course.sections.append(section)
    section.position = payload.position
    section.title = data.title
    section.status = data.status
    section.created_ms = data.created_at
    section.mastery = data.mastery
    section.analysis = data.analysis
    section.analysis_job_id = data.analysis_job_id
    section.knowledge_map = data.knowledge_map
    section.processing_job = data.processing_job
    section.live_started_ms = data.live_started_at
    section.live_ended_ms = data.live_ended_at
    section.live_topic = data.live_topic
    # Child lists are small and always sent whole, so replace them wholesale.
    section.materials = [
        StudyMaterial(
            position=index,
            client_id=item.id,
            name=item.name,
            meta=item.meta,
            file_type=item.type,
            status=item.status,
            progress=item.progress,
            error=item.error,
            preview_url=item.preview_url,
            pages=item.pages,
        )
        for index, item in enumerate(data.materials)
    ]
    section.messages = [
        StudyMessage(position=index, client_id=item.id, role=item.role, content=item.content, node_id=item.node_id)
        for index, item in enumerate(data.chat_history or [])
    ]
    section.branches = [
        StudyBranch(
            position=index, client_id=item.id, title=item.title, parent_id=item.parent_id, question=item.question
        )
        for index, item in enumerate(data.exploration_nodes or [])
    ]
    section.class_questions = [
        ClassQuestion(
            position=index,
            client_id=item.id,
            question=item.question,
            answer=item.answer,
            topic=item.topic,
            status=item.status,
            asked_ms=item.asked_at,
            answered_ms=item.answered_at,
        )
        for index, item in enumerate(data.class_questions or [])
    ]
    db.commit()
