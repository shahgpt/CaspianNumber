from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import is_temp_password
from ..schemas import ChangePasswordIn, LoginIn, TokenOut, UserOut
from ..security import (create_access_token, get_current_user,
                        hash_password, verify_password)

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=TokenOut)
def login(data: LoginIn, db: Session = Depends(get_db)):
    from ..models import User

    user = db.query(User).filter(User.username == data.username.strip().lower()).first()
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="نام کاربری یا رمز عبور اشتباه است")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="حساب شما غیرفعال است")

    must_change = is_temp_password(data.password)
    # سازگاری با حساب‌های موقتی که پیش از اضافه‌شدن ستون ساخته شده‌اند:
    # متنِ رمز فقط همین‌جا در دسترس است، پس یک‌بار تشخیص می‌دهیم و وضعیت را
    # برای تمام نشست‌های بعدی در دیتابیس نگه می‌داریم.
    if must_change and not user.must_change_password:
        user.must_change_password = True
        db.commit()
    must_change = bool(user.must_change_password)
    return TokenOut(
        access_token=create_access_token(user),
        username=user.username,
        must_change_password=must_change,
    )


@router.get("/me", response_model=UserOut)
def me(user=Depends(get_current_user)):
    return user


@router.post("/change-password")
def change_password(
    data: ChangePasswordIn,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not verify_password(data.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="رمز فعلی اشتباه است")
    if len(data.new_password) < 6:
        raise HTTPException(status_code=400, detail="رمز جدید باید حداقل ۶ کاراکتر باشد")
    # رمزِ تازه نباید باز هم موقتی به نظر برسد، وگرنه کاربر هر بار که وارد
    # می‌شود دوباره به همین صفحه برمی‌گردد.
    if is_temp_password(data.new_password):
        raise HTTPException(status_code=400, detail="رمز جدید نمی‌تواند با «tmp-» شروع شود")
    user.password_hash = hash_password(data.new_password)
    user.must_change_password = False
    db.commit()
    return {"ok": True}
