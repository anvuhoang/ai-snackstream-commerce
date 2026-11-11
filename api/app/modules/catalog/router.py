from fastapi import APIRouter, Request

from app.modules.catalog import service
from app.modules.chat.schemas import Product

router = APIRouter(prefix="/api/catalog", tags=["catalog"])


@router.get("/products", response_model=list[Product])
def products(request: Request):
    return service.list_products(request.app.state.settings)


@router.get("/products/{sku}", response_model=Product)
def product(sku: str, request: Request):
    return service.get_product(request.app.state.settings, sku)
