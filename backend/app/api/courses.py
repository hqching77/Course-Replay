from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Course, Document, KnowledgeNode, MasteryRecord
from app.schemas import CourseCreate, CourseRead

router = APIRouter(prefix="/courses", tags=["courses"])


def serialize_course(db: Session, course: Course) -> CourseRead:
    document_count = db.scalar(
        select(func.count(Document.id)).where(Document.course_id == course.id)
    ) or 0
    knowledge_count = db.scalar(
        select(func.count(KnowledgeNode.id)).where(KnowledgeNode.course_id == course.id)
    ) or 0
    mastery = db.scalar(
        select(func.avg(MasteryRecord.score)).where(MasteryRecord.course_id == course.id)
    ) or 0.0
    return CourseRead(
        id=course.id,
        name=course.name,
        description=course.description,
        tags=course.tags,
        status=course.status,
        document_count=document_count,
        knowledge_count=knowledge_count,
        mastery=float(mastery),
        created_at=course.created_at,
        updated_at=course.updated_at,
    )


@router.get("", response_model=list[CourseRead])
def list_courses(db: Session = Depends(get_db)) -> list[CourseRead]:
    courses = db.scalars(select(Course).order_by(Course.updated_at.desc())).all()
    return [serialize_course(db, course) for course in courses]


@router.post("", response_model=CourseRead, status_code=status.HTTP_201_CREATED)
def create_course(payload: CourseCreate, db: Session = Depends(get_db)) -> CourseRead:
    course = Course(
        name=payload.name.strip(),
        description=payload.description.strip(),
        tags=[tag.strip() for tag in payload.tags if tag.strip()],
    )
    db.add(course)
    db.commit()
    db.refresh(course)
    return serialize_course(db, course)


@router.get("/{course_id}", response_model=CourseRead)
def get_course(course_id: str, db: Session = Depends(get_db)) -> CourseRead:
    course = db.get(Course, course_id)
    if course is None:
        raise HTTPException(status_code=404, detail="Course not found")
    return serialize_course(db, course)


@router.delete("/{course_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_course(course_id: str, db: Session = Depends(get_db)) -> None:
    course = db.get(Course, course_id)
    if course is None:
        raise HTTPException(status_code=404, detail="Course not found")
    db.delete(course)
    db.commit()
